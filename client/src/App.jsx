import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import Home from './pages/Home.jsx'
import Courses from './pages/Courses.jsx'
import CourseDetail from './pages/CourseDetail.jsx'
import Pricing from './pages/Pricing.jsx'
import { Login, Register } from './pages/Auth.jsx'
import MyLearning from './pages/MyLearning.jsx'
import Learn from './pages/Learn.jsx'
import Account from './pages/Account.jsx'

function Header() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  return (
    <header className="header">
      <div className="container header-in">
        <Link to="/" className="logo">up<span>Skill</span></Link>
        <nav className="nav">
          <NavLink to="/courses">Courses</NavLink>
          <NavLink to="/pricing">Plans</NavLink>
          {user && <NavLink to="/my-learning">My Learning</NavLink>}
        </nav>
        <div className="nav-right">
          {user ? (
            <>
              <NavLink to="/account" className="btn btn-ghost">{user.name.split(' ')[0]}'s account</NavLink>
              <button className="btn btn-outline" onClick={() => { logout(); nav('/') }}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost">Log in</Link>
              <Link to="/register" className="btn btn-primary">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export function Protected({ children }) {
  const { user, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <div className="container page"><p className="muted">Loading…</p></div>
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  return children
}

export default function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/courses/:id" element={<CourseDetail />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/my-learning" element={<Protected><MyLearning /></Protected>} />
          <Route path="/learn/:id" element={<Protected><Learn /></Protected>} />
          <Route path="/account" element={<Protected><Account /></Protected>} />
          <Route path="*" element={<div className="container page center"><h1>404</h1><p className="muted">That page doesn't exist.</p><Link className="btn btn-primary" to="/">Go home</Link></div>} />
        </Routes>
      </main>
      <footer className="footer"><div className="container">© {new Date().getFullYear()} upSkill — capstone MVP. Payments are simulated; no real charges are made.</div></footer>
    </>
  )
}
