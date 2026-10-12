import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import gsap from 'gsap'
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowRight, BarChart3, Bell, Building2,
  Check, CheckCheck, ChevronDown, ChevronRight, CircleHelp, Clock3, Copy,
  Grid2X2, Layers3, LockKeyhole, LogOut, Mail, Menu, MoreHorizontal, Pause,
  Play, Plus, Search, Send, ShieldCheck, Sparkles, Users, X
} from 'lucide-react'
import './style.css'

const statusMeta = {
  new: { label: 'Nova', className: 'new' },
  in_progress: { label: 'Em andamento', className: 'progress' },
  paused: { label: 'Pausada', className: 'paused' },
  completed: { label: 'Finalizada', className: 'completed' },
  delivered: { label: 'Entregue', className: 'delivered' }
}
const priorityMeta = { low: 'Baixa', normal: 'Normal', high: 'Alta' }
const monthNames = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.detail || 'Algo não saiu como esperado. Tente novamente.')
  return result
}

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
}

function Status({ value }) {
  const meta = statusMeta[value] || statusMeta.new
  return <span className={`status status-${meta.className}`}><span className="status-dot" />{meta.label}</span>
}

function Logo({ compact = false }) {
  return <div className={`logo ${compact ? 'logo-compact' : ''}`}><span className="logo-mark"><span /><span /><span /></span><span>fluxo<span className="logo-period">.</span></span></div>
}

function Spinner() { return <span className="spinner" aria-label="Carregando" /> }

function Auth({ onSuccess, toast }) {
  const [mode, setMode] = useState(new URLSearchParams(location.search).get('reset') ? 'reset' : 'login')
  const [role, setRole] = useState('provider')
  const [form, setForm] = useState({ name: '', company_name: '', email: '', password: '', invite_code: '' })
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [devLink, setDevLink] = useState('')
  const heroRef = useRef(null)

  useEffect(() => {
    if (!heroRef.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = gsap.context(() => {
      gsap.from('.auth-kicker, .auth-hero h1, .auth-hero p, .preview-card', { y: 24, opacity: 0, duration: 0.75, stagger: 0.12, ease: 'power3.out' })
      gsap.to('.orbit-one', { rotation: 360, repeat: -1, duration: 32, ease: 'none' })
      gsap.to('.orbit-two', { rotation: -360, repeat: -1, duration: 42, ease: 'none' })
    }, heroRef)
    return () => ctx.revert()
  }, [])

  const update = e => setForm({ ...form, [e.target.name]: e.target.value })
  const submit = async e => {
    e.preventDefault()
    setLoading(true)
    setMessage('')
    try {
      if (mode === 'login') {
        const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(form) })
        onSuccess(result.user)
      } else if (mode === 'register') {
        const result = await api('/auth/register', { method: 'POST', body: JSON.stringify({ ...form, role }) })
        onSuccess(result.user, result.invite_code)
      } else if (mode === 'forgot') {
        const result = await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: form.email }) })
        setMessage(result.message)
        setDevLink(result.development_reset_url || '')
      } else {
        await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token: new URLSearchParams(location.search).get('reset'), password: form.password }) })
        history.replaceState({}, '', '/')
        setMode('login')
        toast('Senha atualizada. Entre na sua conta.')
      }
    } catch (error) { setMessage(error.message) }
    finally { setLoading(false) }
  }

  return <main className="auth-shell">
    <section className="auth-hero" ref={heroRef}>
      <Logo />
      <div className="orbit orbit-one" /><div className="orbit orbit-two" />
      <div className="auth-hero-content">
        <span className="eyebrow auth-kicker"><Sparkles size={14} /> Trabalho em sintonia</span>
        <h1>Menos ruído.<br /><em>Mais movimento.</em></h1>
        <p>Um lugar tranquilo para acompanhar cada pedido, do primeiro contato à entrega.</p>
        <div className="preview-card tilt-card" onMouseMove={tiltCard} onMouseLeave={resetTilt}>
          <div className="preview-top"><span className="preview-avatar">AC</span><span><strong>Atualização de identidade</strong><small>Ateliê Criativo · Agora</small></span><span className="preview-icon"><ArrowDownRight size={17} /></span></div>
          <div className="preview-progress"><span /></div>
          <div className="preview-bottom"><span><span className="live-dot" /> Em andamento</span><span>75% concluído</span></div>
        </div>
        <div className="hero-proof"><span className="proof-icon"><Check size={15} /></span> Tudo em um só lugar, para todos os lados.</div>
      </div>
      <div className="auth-hero-footer">© 2026 Fluxo <span>Feito para simplificar.</span></div>
    </section>
    <section className="auth-panel">
      <div className="auth-mobile-logo"><Logo /></div>
      <div className="auth-form-wrap">
        <div className="form-heading">
          {mode === 'login' && <><span className="form-icon"><LockKeyhole size={21} /></span><h2>Bem-vindo de volta</h2><p>Entre para continuar de onde parou.</p></>}
          {mode === 'register' && <><span className="form-icon"><Sparkles size={21} /></span><h2>Vamos começar?</h2><p>Seu espaço de trabalho fica pronto em instantes.</p></>}
          {mode === 'forgot' && <><span className="form-icon"><Mail size={21} /></span><h2>Recuperar senha</h2><p>Enviaremos um link seguro para seu email.</p></>}
          {mode === 'reset' && <><span className="form-icon"><ShieldCheck size={21} /></span><h2>Nova senha</h2><p>Escolha uma senha com pelo menos 8 caracteres.</p></>}
        </div>
        {mode === 'register' && <div className="role-switch" role="group" aria-label="Tipo de conta"><button type="button" className={role === 'provider' ? 'selected' : ''} onClick={() => setRole('provider')}><Building2 size={16} /> Sou empresa</button><button type="button" className={role === 'client' ? 'selected' : ''} onClick={() => setRole('client')}><Users size={16} /> Sou cliente</button></div>}
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <><label>Seu nome<input name="name" value={form.name} onChange={update} placeholder="Como podemos chamar você?" required minLength="2" /></label>{role === 'provider' && <label>Nome da empresa<input name="company_name" value={form.company_name} onChange={update} placeholder="Ex.: Estúdio Aurora" required minLength="2" /></label>}</>}
          {mode !== 'reset' && <label>Email<input name="email" type="email" value={form.email} onChange={update} placeholder="voce@exemplo.com" required autoComplete="email" /></label>}
          {mode !== 'forgot' && <label>Senha<input name="password" type="password" value={form.password} onChange={update} placeholder={mode === 'login' ? 'Sua senha' : 'Mínimo de 8 caracteres'} required minLength={mode === 'login' ? 1 : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>}
          {mode === 'register' && role === 'client' && <label>Código de convite<input name="invite_code" value={form.invite_code} onChange={update} placeholder="Código enviado pela empresa" required autoCapitalize="characters" /><small>Peça este código à empresa que vai receber suas demandas.</small></label>}
          {mode === 'login' && <button type="button" className="text-link forgot-link" onClick={() => { setMode('forgot'); setMessage('') }}>Esqueceu a senha?</button>}
          {message && <div className={`form-message ${mode === 'forgot' && !message.includes('inválido') ? 'success' : ''}`}>{message}{devLink && <a href={devLink}>Abrir link de recuperação local</a>}</div>}
          <button className="primary-button auth-submit" disabled={loading}>{loading ? <Spinner /> : <>{mode === 'login' ? 'Entrar na minha conta' : mode === 'register' ? 'Criar minha conta' : mode === 'forgot' ? 'Enviar link' : 'Salvar nova senha'}<ArrowRight size={17} /></>}</button>
        </form>
        <div className="auth-bottom">{mode === 'login' ? <>Ainda não tem uma conta? <button className="text-link" onClick={() => { setMode('register'); setMessage('') }}>Criar conta</button></> : <>Já tem uma conta? <button className="text-link" onClick={() => { setMode('login'); setMessage('') }}>Fazer login</button></>}</div>
        <p className="auth-security"><ShieldCheck size={15} /> Seus dados ficam visíveis apenas para quem faz parte deles.</p>
      </div>
    </section>
  </main>
}

function tiltCard(event) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const el = event.currentTarget
  const rect = el.getBoundingClientRect()
  const x = (event.clientX - rect.left) / rect.width - .5
  const y = (event.clientY - rect.top) / rect.height - .5
  gsap.to(el, { rotationY: x * 9, rotationX: -y * 7, y: -3, duration: .35, ease: 'power2.out' })
}
function resetTilt(event) { gsap.to(event.currentTarget, { rotationY: 0, rotationX: 0, y: 0, duration: .55, ease: 'power2.out' }) }

function Modal({ title, subtitle, onClose, children, wide = false }) {
  const ref = useRef(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    if (ref.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) gsap.fromTo(ref.current, { y: 18, opacity: 0, scale: .98 }, { y: 0, opacity: 1, scale: 1, duration: .3, ease: 'power2.out' })
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className={`modal ${wide ? 'modal-wide' : ''}`} ref={ref} role="dialog" aria-modal="true" aria-label={title}><div className="modal-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></div>{children}</div></div>
}

function DemandForm({ companies, onClose, onCreate, toast }) {
  const [form, setForm] = useState({ company_id: companies[0]?.id || '', title: '', description: '', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const submit = async e => {
    e.preventDefault(); setBusy(true)
    try { await api('/demands', { method: 'POST', body: JSON.stringify(form) }); toast('Demanda enviada! A empresa já recebeu um aviso.'); onCreate(); onClose() }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }
  return <Modal title="Nova demanda" subtitle="Conte o que você precisa. O resto fica organizado aqui." onClose={onClose}><form className="modal-form" onSubmit={submit}><label>Enviar para<select value={form.company_id} onChange={e => setForm({ ...form, company_id: e.target.value })} required>{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Título da demanda<input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ex.: Atualizar página inicial" required minLength="3" maxLength="120" /></label><label>Descrição<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Explique o objetivo, os detalhes importantes e o prazo desejado..." rows="5" required minLength="10" maxLength="4000" /></label><label>Prioridade<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="normal">Normal</option><option value="low">Baixa</option><option value="high">Alta</option></select></label><div className="form-actions"><button type="button" className="ghost-button" onClick={onClose}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? <Spinner /> : <><Send size={16} /> Enviar demanda</>}</button></div></form></Modal>
}

function DemandDetail({ demand, role, onClose, onUpdate, toast }) {
  const [busy, setBusy] = useState(false)
  const actions = { new: [{ label: 'Iniciar', status: 'in_progress', icon: Play }], in_progress: [{ label: 'Pausar', status: 'paused', icon: Pause }, { label: 'Finalizar', status: 'completed', icon: Check }], paused: [{ label: 'Retomar', status: 'in_progress', icon: Play }, { label: 'Finalizar', status: 'completed', icon: Check }], completed: [{ label: 'Marcar entregue', status: 'delivered', icon: CheckCheck }] }
  const change = async status => {
    setBusy(true)
    try { await api(`/demands/${demand.id}/status`, { method: 'POST', body: JSON.stringify({ status }) }); toast('Etapa atualizada. O cliente foi avisado.'); onUpdate(); onClose() }
    catch (error) { toast(error.message, 'error') }
    finally { setBusy(false) }
  }
  return <Modal title={demand.title} subtitle={`Criada em ${formatDate(demand.created_at)}`} onClose={onClose} wide><div className="detail-tags"><Status value={demand.status} /><span className="soft-tag">{priorityMeta[demand.priority]} prioridade</span></div><div className="detail-grid"><div><small>EMPRESA</small><strong>{demand.company_name}</strong></div><div><small>CLIENTE</small><strong>{demand.client_name}</strong></div><div><small>CRIADA EM</small><strong>{formatDate(demand.created_at)}</strong></div></div><div className="detail-description"><h3>Sobre esta demanda</h3><p>{demand.description}</p></div><div className="detail-timeline"><h3>Progresso</h3><div className="timeline-items"><span className="done"><i /> Recebida</span><span className={demand.started_at ? 'done' : ''}><i /> Iniciada</span><span className={demand.completed_at ? 'done' : ''}><i /> Finalizada</span><span className={demand.delivered_at ? 'done' : ''}><i /> Entregue</span></div></div>{role === 'provider' && !!actions[demand.status]?.length && <div className="detail-actions">{actions[demand.status].map((action, index) => <button key={action.status} className={index === actions[demand.status].length - 1 ? 'primary-button' : 'ghost-button'} disabled={busy} onClick={() => change(action.status)}><action.icon size={16} /> {action.label}</button>)}</div>}</Modal>
}

function InviteModal({ code, companyName, onClose, toast }) {
  const copy = async () => { await navigator.clipboard.writeText(code); toast('Código copiado!') }
  return <Modal title="Convide seus clientes" subtitle={`Compartilhe este código para dar acesso a ${companyName}.`} onClose={onClose}><div className="invite-box"><span>CÓDIGO DE CONVITE</span><strong>{code}</strong><button className="secondary-button" onClick={copy}><Copy size={16} /> Copiar código</button></div><p className="hint">Por segurança, o código completo aparece apenas agora. Você poderá gerar outro a qualquer momento.</p><button className="primary-button full-button" onClick={onClose}>Entendi <ArrowRight size={16} /></button></Modal>
}

function App() {
  const [user, setUser] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [view, setView] = useState('overview')
  const [companies, setCompanies] = useState([])
  const [demands, setDemands] = useState([])
  const [stats, setStats] = useState(null)
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)
  const [selectedCompany, setSelectedCompany] = useState('all')
  const [selectedStatus, setSelectedStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(null)
  const [selectedDemand, setSelectedDemand] = useState(null)
  const [invite, setInvite] = useState(null)
  const [newCompany, setNewCompany] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [clients, setClients] = useState([])
  const [toastState, setToastState] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notificationOpen, setNotificationOpen] = useState(false)
  const mainRef = useRef(null)
  const toast = useCallback((message, type = 'success') => { setToastState({ message, type }); setTimeout(() => setToastState(null), 4200) }, [])

  const refresh = useCallback(async () => {
    if (!user) return
    try {
      const [companyData, demandData, statData, noticeData] = await Promise.all([api('/companies'), api('/demands'), api('/dashboard'), api('/notifications')])
      setCompanies(companyData.companies); setDemands(demandData.demands); setStats(statData); setNotifications(noticeData.notifications); setUnread(noticeData.unread)
    } catch (error) { toast(error.message, 'error') }
  }, [user, toast])

  useEffect(() => { api('/me').then(result => setUser(result.user)).catch(() => {}).finally(() => setInitializing(false)) }, [])
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (!user) return; const id = setInterval(refresh, 30000); return () => clearInterval(id) }, [user, refresh])
  useEffect(() => { if (!mainRef.current || !user || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; gsap.fromTo(mainRef.current, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .45, ease: 'power2.out' }) }, [view, user])
  useEffect(() => { if (!user || user.role !== 'provider' || companies.length === 0) return; const id = selectedCompany === 'all' ? companies[0].id : selectedCompany; api(`/companies/${id}/clients`).then(data => setClients(data.clients)).catch(() => setClients([])) }, [user, companies, selectedCompany])

  const success = (nextUser, inviteCode) => { setUser(nextUser); if (inviteCode) setInvite({ code: inviteCode, companyName: 'sua empresa' }); toast(`Bem-vindo, ${nextUser.name.split(' ')[0]}!`) }
  const logout = async () => { await api('/auth/logout', { method: 'POST' }); setUser(null); setView('overview'); setCompanies([]); setDemands([]) }
  const openNotifications = async () => { setNotificationOpen(!notificationOpen); if (!notificationOpen && unread) { await api('/notifications/read', { method: 'POST' }).catch(() => {}); setUnread(0); setNotifications(items => items.map(item => ({ ...item, read_at: new Date().toISOString() }))) } }
  const filtered = demands.filter(d => (selectedCompany === 'all' || d.company_id === selectedCompany) && (selectedStatus === 'all' || d.status === selectedStatus) && (!search || `${d.title} ${d.company_name} ${d.client_name}`.toLowerCase().includes(search.toLowerCase())))
  const visibleCompanies = selectedCompany === 'all' ? companies : companies.filter(c => c.id === selectedCompany)
  const role = user?.role
  const firstName = user?.name?.split(' ')[0]

  const makeCompany = async e => { e.preventDefault(); try { const result = await api('/companies', { method: 'POST', body: JSON.stringify({ name: newCompany }) }); setModal(null); setNewCompany(''); setInvite({ code: result.invite_code, companyName: result.company.name }); await refresh(); toast('Empresa criada!') } catch (error) { toast(error.message, 'error') } }
  const joinCompany = async e => { e.preventDefault(); try { const result = await api('/companies/join', { method: 'POST', body: JSON.stringify({ invite_code: joinCode }) }); setModal(null); setJoinCode(''); await refresh(); toast(`Conectado a ${result.company.name}!`) } catch (error) { toast(error.message, 'error') } }
  const rotateCode = async company => { try { const result = await api(`/companies/${company.id}/invite`, { method: 'POST' }); setInvite({ code: result.invite_code, companyName: company.name }); await refresh() } catch (error) { toast(error.message, 'error') } }

  if (initializing) return <div className="app-loading"><Logo /><Spinner /></div>
  if (!user) return <><Auth onSuccess={success} toast={toast} />{toastState && <div className={`toast toast-${toastState.type}`}>{toastState.message}</div>}</>

  const nav = [{ id: 'overview', label: 'Visão geral', icon: Grid2X2 }, { id: 'demands', label: 'Demandas', icon: Layers3 }, { id: 'companies', label: role === 'provider' ? 'Empresas e clientes' : 'Minhas empresas', icon: role === 'provider' ? Users : Building2 }]
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}><div className="sidebar-head"><Logo compact /><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={20} /></button></div><div className="workspace-label">ESPAÇO DE TRABALHO</div><nav className="sidebar-nav">{nav.map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => { setView(item.id); setMobileOpen(false) }}><item.icon size={18} strokeWidth={1.9} />{item.label}{view === item.id && <span className="nav-indicator" />}</button>)}</nav><div className="sidebar-lower"><div className="help-card"><span className="help-icon"><CircleHelp size={19} /></span><strong>Uma coisa de cada vez.</strong><p>Seu trabalho flui melhor quando tudo está no lugar certo.</p><span className="help-decoration" /></div><button className="sidebar-logout" onClick={logout}><LogOut size={17} /> Sair da conta</button><div className="profile"><span className="profile-avatar">{initials(user.name)}</span><span><strong>{user.name}</strong><small>{role === 'provider' ? 'Conta empresa' : 'Conta cliente'}</small></span><MoreHorizontal size={18} /></div></div></aside>
    {mobileOpen && <div className="sidebar-scrim" onClick={() => setMobileOpen(false)} />}
    <div className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button><span className="breadcrumb">Workspace <ChevronRight size={14} /> <strong>{nav.find(n => n.id === view)?.label}</strong></span></div><div className="topbar-actions"><span className="today-label">{new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span><div className="notification-wrap"><button className="notification-button" onClick={openNotifications} aria-label="Notificações"><Bell size={19} />{unread > 0 && <i />}</button>{notificationOpen && <div className="notification-popover"><div className="popover-head"><strong>Notificações</strong><span>{unread ? `${unread} novas` : 'Tudo em dia'}</span></div>{notifications.length ? notifications.slice(0, 8).map(n => <button key={n.id} className="notice" onClick={() => { setNotificationOpen(false); const demand = demands.find(d => d.id === n.demand_id); if (demand) setSelectedDemand(demand) }}><span className="notice-icon"><Bell size={15} /></span><span><strong>{n.title}</strong><small>{n.body}</small><em>{formatDate(n.created_at)}</em></span></button>) : <div className="empty-notices"><Bell size={22} /> Nenhum aviso por enquanto.</div>}</div>}</div><span className="topbar-avatar">{initials(user.name)}</span></div></header>
      <main className="content" ref={mainRef}>
        {view === 'overview' && <><div className="page-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> SEU PAINEL</span><h1>Olá, {firstName} <span className="wave">✳</span></h1><p>{role === 'provider' ? 'Aqui está o que está acontecendo com suas demandas.' : 'Acompanhe seus pedidos de um jeito simples e claro.'}</p></div><button className="primary-button" onClick={() => role === 'client' ? (companies.length ? setModal('demand') : setModal('join')) : setModal('company')}><Plus size={18} /> {role === 'client' ? 'Nova demanda' : 'Nova empresa'}</button></div>
          <div className="stats-grid"><Metric icon={Layers3} label="Total de demandas" value={stats?.total ?? 0} tone="purple" foot="Desde o início" /><Metric icon={Activity} label="Em andamento" value={stats?.active ?? 0} tone="orange" foot="Inclui pausadas" /><Metric icon={CheckCheck} label="Entregues" value={stats?.delivered ?? 0} tone="green" foot="Concluídas e entregues" /><Metric icon={Clock3} label="Tempo médio" value={stats?.average_hours ? `${stats.average_hours}h` : '—'} tone="blue" foot="Da criação à finalização" /></div>
          <div className="overview-grid"><section className="card chart-card tilt-card" onMouseMove={tiltCard} onMouseLeave={resetTilt}><div className="card-heading"><div><span className="section-eyebrow">PANORAMA</span><h2>Demandas ao longo do tempo</h2><p>Novos pedidos nos últimos 6 meses</p></div><span className="card-icon"><BarChart3 size={19} /></span></div><Chart data={stats?.chart || []} /></section><section className="card activity-card"><div className="card-heading"><div><span className="section-eyebrow">ACOMPANHAMENTO</span><h2>Atividade recente</h2><p>Atualizações que importam para você</p></div><span className="card-icon"><Activity size={19} /></span></div><div className="activity-list">{notifications.length ? notifications.slice(0, 4).map(n => <div className="activity-item" key={n.id}><span className="activity-icon"><Bell size={15} /></span><div><strong>{n.title}</strong><p>{n.body}</p><small>{formatDate(n.created_at)}</small></div></div>) : <div className="activity-empty"><span className="empty-symbol"><Sparkles size={23} /></span><strong>Tudo tranquilo por aqui</strong><p>As atualizações das suas demandas aparecerão neste espaço.</p></div>}</div></section></div>
          <section className="card recent-card"><div className="section-head"><div><span className="section-eyebrow">ORGANIZAÇÃO</span><h2>Demandas recentes</h2></div><button className="subtle-button" onClick={() => setView('demands')}>Ver todas <ArrowRight size={15} /></button></div><DemandTable demands={demands.slice(0, 5)} role={role} onSelect={setSelectedDemand} compact /></section></>}
        {view === 'demands' && <><div className="page-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> ACOMPANHAMENTO</span><h1>Demandas <span className="muted-count">{demands.length}</span></h1><p>{role === 'provider' ? 'Cada etapa visível, do início à entrega.' : 'Tudo o que você pediu, em um só lugar.'}</p></div>{role === 'client' && <button className="primary-button" onClick={() => companies.length ? setModal('demand') : setModal('join')}><Plus size={18} /> Nova demanda</button>}</div><section className="card demands-card"><div className="filters"><div className="search-wrap"><Search size={18} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar demanda..." aria-label="Buscar demanda" /></div><select value={selectedCompany} onChange={e => setSelectedCompany(e.target.value)} aria-label="Filtrar por empresa"><option value="all">Todas as empresas</option>{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div><div className="status-tabs">{[['all', 'Todas'], ['new', 'Novas'], ['in_progress', 'Em andamento'], ['paused', 'Pausadas'], ['completed', 'Finalizadas'], ['delivered', 'Entregues']].map(([value, label]) => <button key={value} className={selectedStatus === value ? 'active' : ''} onClick={() => setSelectedStatus(value)}>{label}</button>)}</div><DemandTable demands={filtered} role={role} onSelect={setSelectedDemand} /></section></>}
        {view === 'companies' && <><div className="page-intro"><div><span className="eyebrow"><span className="eyebrow-line" /> CONEXÕES</span><h1>{role === 'provider' ? 'Empresas e clientes' : 'Minhas empresas'} <span className="muted-count">{companies.length}</span></h1><p>{role === 'provider' ? 'Seus espaços e as pessoas conectadas a cada um.' : 'Empresas com quem você compartilha demandas.'}</p></div><button className="primary-button" onClick={() => setModal(role === 'provider' ? 'company' : 'join')}><Plus size={18} /> {role === 'provider' ? 'Nova empresa' : 'Adicionar empresa'}</button></div><section className="card company-card"><div className="section-head"><div><span className="section-eyebrow">SEUS ESPAÇOS</span><h2>Empresas conectadas</h2></div></div>{companies.length ? <div className="company-list">{companies.map(company => <div className="company-row" key={company.id}><span className="company-avatar"><Building2 size={21} /></span><span className="company-main"><strong>{company.name}</strong><small>{role === 'provider' ? `${company.client_count} ${company.client_count === 1 ? 'cliente' : 'clientes'} · ${company.demand_count} demandas` : `Conectada em ${formatDate(company.joined_at)}`}</small></span>{role === 'provider' && <button className="secondary-button" onClick={() => rotateCode(company)}><Copy size={15} /> Gerar convite</button>}</div>)}</div> : <EmptyState icon={Building2} title="Nenhuma empresa ainda" description={role === 'provider' ? 'Crie sua primeira empresa para convidar clientes.' : 'Use o código recebido para se conectar a uma empresa.'} actionLabel={role === 'provider' ? 'Criar empresa' : 'Usar convite'} onAction={() => setModal(role === 'provider' ? 'company' : 'join')} />}</section>{role === 'provider' && companies.length > 0 && <section className="card clients-card"><div className="section-head"><div><span className="section-eyebrow">RELACIONAMENTOS</span><h2>Clientes</h2></div><select value={selectedCompany === 'all' ? companies[0].id : selectedCompany} onChange={e => setSelectedCompany(e.target.value)} aria-label="Empresa dos clientes">{companies.map(c => <option value={c.id} key={c.id}>{c.name}</option>)}</select></div>{clients.length ? <div className="table-scroll"><table><thead><tr><th>CLIENTE</th><th>EMAIL</th><th>DEMANDAS</th><th>DESDE</th></tr></thead><tbody>{clients.map(client => <tr key={client.id}><td><div className="person-cell"><span className="small-avatar">{initials(client.name)}</span><strong>{client.name}</strong></div></td><td>{client.email}</td><td>{client.demand_count}</td><td>{formatDate(client.created_at)}</td></tr>)}</tbody></table></div> : <div className="simple-empty">Nenhum cliente conectado a esta empresa. Compartilhe o código de convite para começar.</div>}</section>}</>}
      </main>
    </div>
    {modal === 'demand' && <DemandForm companies={companies} onClose={() => setModal(null)} onCreate={refresh} toast={toast} />}
    {modal === 'company' && <Modal title="Nova empresa" subtitle="Crie um novo espaço para organizar seus clientes." onClose={() => setModal(null)}><form className="modal-form" onSubmit={makeCompany}><label>Nome da empresa<input value={newCompany} onChange={e => setNewCompany(e.target.value)} placeholder="Ex.: Estúdio Aurora" required minLength="2" /></label><div className="form-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button"><Plus size={16} /> Criar empresa</button></div></form></Modal>}
    {modal === 'join' && <Modal title="Adicionar empresa" subtitle="Insira o código que a empresa compartilhou com você." onClose={() => setModal(null)}><form className="modal-form" onSubmit={joinCompany}><label>Código de convite<input value={joinCode} onChange={e => setJoinCode(e.target.value)} placeholder="Digite o código de convite" required autoCapitalize="characters" /></label><div className="form-actions"><button type="button" className="ghost-button" onClick={() => setModal(null)}>Cancelar</button><button className="primary-button"><ArrowRight size={16} /> Conectar</button></div></form></Modal>}
    {selectedDemand && <DemandDetail demand={selectedDemand} role={role} onClose={() => setSelectedDemand(null)} onUpdate={refresh} toast={toast} />}
    {invite && <InviteModal code={invite.code} companyName={invite.companyName} onClose={() => setInvite(null)} toast={toast} />}
    {toastState && <div className={`toast toast-${toastState.type}`} role="status">{toastState.type === 'success' ? <Check size={17} /> : <CircleHelp size={17} />}{toastState.message}</div>}
  </div>
}

function Metric({ icon: Icon, label, value, tone, foot }) { return <div className={`metric-card metric-${tone} tilt-card`} onMouseMove={tiltCard} onMouseLeave={resetTilt}><div className="metric-top"><span className="metric-icon"><Icon size={20} strokeWidth={1.9} /></span><ArrowDownRight size={17} className="metric-arrow" /></div><strong>{value}</strong><span>{label}</span><small>{foot}</small></div> }

function Chart({ data }) {
  const [mode, setMode] = useState('count')
  const max = Math.max(1, ...data.map(item => item[mode] || 0))
  const valueLabel = value => mode === 'count' ? String(value) : `${value}h`
  return <><div className="chart-switch" role="group" aria-label="Métrica do gráfico">{[['count', 'Quantidade'], ['total_hours', 'Tempo'], ['average_hours', 'Média']].map(([key, label]) => <button key={key} className={mode === key ? 'active' : ''} onClick={() => setMode(key)}>{label}</button>)}</div><div className="chart"><div className="chart-grid"><span>{valueLabel(max)}</span><span>{valueLabel(Math.round(max / 2 * 10) / 10)}</span><span>0</span></div><div className="chart-bars">{data.map((item, index) => <div className="bar-column" key={item.month} title={`${item.month}: ${valueLabel(item[mode] || 0)}`}><span className="bar-count">{valueLabel(item[mode] || 0)}</span><div className="bar-track"><div className={`bar-fill ${index === data.length - 1 ? 'bar-current' : ''}`} style={{ height: `${Math.max(item[mode] ? 12 : 3, (item[mode] || 0) / max * 100)}%` }} /></div><small>{monthNames[Number(item.month.slice(5)) - 1]}</small></div>)}</div></div></>
}

function DemandTable({ demands, role, onSelect, compact = false }) { return demands.length ? <div className="table-scroll"><table className="demands-table"><thead><tr><th>DEMANDA</th><th>{role === 'provider' ? 'CLIENTE' : 'EMPRESA'}</th><th>CRIADA EM</th><th>STATUS</th><th /></tr></thead><tbody>{demands.map(d => <tr key={d.id} onClick={() => onSelect(d)} tabIndex="0" onKeyDown={e => { if (e.key === 'Enter') onSelect(d) }}><td><div className="demand-name"><span className="demand-icon"><Layers3 size={17} /></span><span><strong>{d.title}</strong><small>{priorityMeta[d.priority]} prioridade</small></span></div></td><td>{role === 'provider' ? d.client_name : d.company_name}</td><td>{formatDate(d.created_at)}</td><td><Status value={d.status} /></td><td><ChevronRight size={18} /></td></tr>)}</tbody></table></div> : <EmptyState icon={Layers3} title={compact ? 'Nenhuma demanda recente' : 'Nenhuma demanda encontrada'} description={compact ? 'Quando houver um novo pedido, ele aparecerá aqui.' : 'As demandas aparecem aqui assim que forem criadas.'} /> }

function EmptyState({ icon: Icon, title, description, actionLabel, onAction }) { return <div className="empty-state"><span className="empty-icon"><Icon size={25} /></span><strong>{title}</strong><p>{description}</p>{actionLabel && <button className="secondary-button" onClick={onAction}><Plus size={16} /> {actionLabel}</button>}</div> }

createRoot(document.getElementById('root')).render(<App />)


