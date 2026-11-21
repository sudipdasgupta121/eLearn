import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import CourseCard from '../components/CourseCard.jsx'

export default function Courses() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState({ courses: [], categories: [] })
  const [loading, setLoading] = useState(true)
  const f = { search: params.get('search') || '', category: params.get('category') || '', level: params.get('level') || '', sort: params.get('sort') || '' }
  const [text, setText] = useState(f.search)
  const qs = params.toString()

  useEffect(() => {
    setLoading(true)
    api('/courses?' + qs).then(setData).finally(() => setLoading(false))
  }, [qs])

  const update = (k, v) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next)
  }

  return (
    <div className="container page">
      <h1>All courses</h1>
      <form className="filters" onSubmit={(e) => { e.preventDefault(); update('search', text) }}>
        <input aria-label="Search courses" placeholder="Search courses, topics, instructors" value={text} onChange={(e) => setText(e.target.value)} />
        <select aria-label="Category" value={f.category} onChange={(e) => update('category', e.target.value)}>
          <option value="">All categories</option>
          {data.categories.map((c) => <option key={c.category}>{c.category}</option>)}
        </select>
        <select aria-label="Level" value={f.level} onChange={(e) => update('level', e.target.value)}>
          <option value="">All levels</option>
          <option>Beginner</option><option>Intermediate</option><option>Advanced</option>
        </select>
        <select aria-label="Sort by" value={f.sort} onChange={(e) => update('sort', e.target.value)}>
          <option value="">Most popular</option>
          <option value="rating">Highest rated</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="newest">Newest</option>
        </select>
        <button className="btn btn-primary">Search</button>
      </form>
      {loading ? <p className="muted">Loading…</p> : data.courses.length === 0 ? (
        <p className="muted">No courses match your filters.</p>
      ) : (
        <>
          <p className="muted">{data.courses.length} course{data.courses.length > 1 ? 's' : ''}</p>
          <div className="grid">{data.courses.map((c) => <CourseCard key={c.id} course={c} />)}</div>
        </>
      )}
    </div>
  )
}
