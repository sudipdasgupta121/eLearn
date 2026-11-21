import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../AuthContext.jsx'

function Form({ mode }) {
  const { login, register } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [f, setF] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const reg = mode === 'register'
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (reg) await register(f.name, f.email, f.password); else await login(f.email, f.password)
      nav(loc.state?.from || '/my-learning', { replace: true })
    } catch (err) { setError(err.message); setBusy(false) }
  }

  return (
    <div className="container page auth">
      <form className="card auth-card" onSubmit={submit}>
        <h1>{reg ? 'Create your account' : 'Welcome back'}</h1>
        {reg && <label>Full name<input required maxLength={100} value={f.name} onChange={set('name')} /></label>}
        <label>Email<input type="email" required value={f.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required minLength={8} maxLength={72} autoComplete={reg ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} />{reg && <span className="hint">At least 8 characters with a letter and a number</span>}</label>
        {error && <div className="alert alert-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Please wait…' : reg ? 'Sign up' : 'Log in'}</button>
        <p className="muted small">
          {reg ? <>Already registered? <Link to="/login" state={loc.state}>Log in</Link></> : <>New to upSkill? <Link to="/register" state={loc.state}>Create an account</Link></>}
        </p>
      </form>
    </div>
  )
}
export const Login = () => <Form mode="login" />
export const Register = () => <Form mode="register" />
