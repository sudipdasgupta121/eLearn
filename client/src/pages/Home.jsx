import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import CourseCard from '../components/CourseCard.jsx'

export default function Home() {
  const [data, setData] = useState({ courses: [], categories: [] })
  const [q, setQ] = useState('')
  const nav = useNavigate()
  useEffect(() => { api('/courses').then(setData) }, [])
  const search = (e) => { e.preventDefault(); nav(`/courses?search=${encodeURIComponent(q)}`) }

  return (
    <>
      <section className="hero">
        <div className="container hero-in">
          <div>
            <h1>Learn in-demand skills.<br />Build the career you want.</h1>
            <p>Industry-led courses in programming, data, design and business. Buy a course or unlock the catalog with a plan.</p>
            <form className="search" onSubmit={search}>
              <input placeholder="What do you want to learn? e.g. Python, SQL, Design" value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn btn-primary">Search</button>
            </form>
            <div className="stats"><span><b>{data.courses.length || 13}</b> courses</span><span><b>85k+</b> learners</span><span><b>4.7</b> avg. rating</span></div>
          </div>
          <div className="hero-art">🎓</div>
        </div>
      </section>

      <section className="container section">
        <h2>Browse by category</h2>
        <div className="chips">
          {data.categories.map((c) => (
            <Link key={c.category} className="chip" to={`/courses?category=${encodeURIComponent(c.category)}`}>{c.category} <small>{c.count}</small></Link>
          ))}
        </div>
      </section>

      <section className="container section">
        <div className="row between"><h2>Popular courses</h2><Link to="/courses">View all →</Link></div>
        <div className="grid">{data.courses.slice(0, 8).map((c) => <CourseCard key={c.id} course={c} />)}</div>
      </section>

      <section className="container section">
        <div className="cta">
          <div>
            <h2>Learn more for less with a subscription</h2>
            <p>Plans start at $9/month. Upgrade, downgrade or cancel anytime.</p>
          </div>
          <Link to="/pricing" className="btn btn-light">See plans</Link>
        </div>
      </section>
    </>
  )
}
