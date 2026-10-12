import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isWindows = process.platform === 'win32'
const pythonName = isWindows ? 'python.exe' : 'python'
const healthUrl = 'http://127.0.0.1:8000/api/health'
const siteUrl = 'http://127.0.0.1:5173/'
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function pythonCandidates() {
  const candidates = []
  const add = (command, args = []) => { if (command) candidates.push({ command, args }) }
  add(process.env.PYTHON_EXECUTABLE)
  if (process.env.VIRTUAL_ENV) add(path.join(process.env.VIRTUAL_ENV, isWindows ? 'Scripts/python.exe' : 'bin/python'))
  add(path.join(root, '.venv', isWindows ? 'Scripts/python.exe' : 'bin/python'))
  if (isWindows) add('py', ['-3'])
  add('python')
  add('python3')
  if (isWindows) add(path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', pythonName))
  return candidates
}

function findPython() {
  for (const candidate of pythonCandidates()) {
    if (candidate.command.includes(path.sep) && !existsSync(candidate.command)) continue
    const check = spawnSync(candidate.command, [...candidate.args, '-c', 'import fastapi, uvicorn'], {
      cwd: root, stdio: 'ignore', timeout: 6000, windowsHide: true
    })
    if (check.status === 0) return candidate
  }
  return null
}

async function apiHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) })
    return response.ok && (await response.json()).ok === true
  } catch { return false }
}

async function siteHealthy() {
  try {
    const response = await fetch(siteUrl, { signal: AbortSignal.timeout(1000) })
    return response.ok && (await response.text()).includes('<title>Fluxo')
  } catch { return false }
}

let backend = null
let frontend = null
let stopping = false

function stop() {
  if (stopping) return
  stopping = true
  if (frontend && frontend.exitCode === null) frontend.kill()
  if (backend && backend.exitCode === null) backend.kill()
}

process.on('SIGINT', () => { stop(); process.exit(130) })
process.on('SIGTERM', () => { stop(); process.exit(143) })
process.on('exit', stop)

async function main() {
  if (!existsSync(viteBin)) throw new Error('Dependências do React ausentes. Execute npm install primeiro.')

  if (await apiHealthy()) {
    console.log('API já está ativa em http://127.0.0.1:8000')
  } else {
    const python = findPython()
    if (!python) {
      throw new Error(
        'Python com FastAPI e Uvicorn não encontrado. Instale Python 3.12+, execute '
        + 'python -m pip install -r requirements.txt e rode npm run dev novamente. '
        + 'Se necessário, defina PYTHON_EXECUTABLE com o caminho do python.exe.'
      )
    }
    console.log('Iniciando a API Python...')
    backend = spawn(python.command, [
      ...python.args, '-m', 'uvicorn', 'api.index:app',
      '--host', '127.0.0.1', '--port', '8000'
    ], { cwd: root, stdio: 'inherit', windowsHide: true })

    let ready = false
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await apiHealthy()) { ready = true; break }
      if (backend.exitCode !== null) break
      await delay(300)
    }
    if (!ready) throw new Error('A API não iniciou na porta 8000. Confira o erro Python acima.')
  }

  if (backend) {
    backend.on('exit', code => {
      if (!stopping) {
        console.error(`A API foi encerrada (${code ?? 'sem código'}).`)
        stop()
        process.exitCode = 1
      }
    })
  }

  if (await siteHealthy()) {
    console.log(`API pronta. O site já está ativo em ${siteUrl}`)
    if (backend) await new Promise(resolve => backend.once('exit', resolve))
    return
  }

  console.log('API pronta. Iniciando o site...')
  frontend = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--strictPort'], {
    cwd: root, stdio: 'inherit', windowsHide: true
  })
  frontend.on('exit', code => { stop(); process.exitCode = code ?? 1 })
}

main().catch(error => {
  console.error(`\n${error.message}\n`)
  stop()
  process.exitCode = 1
})
