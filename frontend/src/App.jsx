import { Routes, Route, Navigate } from 'react-router-dom'
import { pb } from './lib/pb'
import Login from './pages/Login'
import Layout from './components/Layout'
import Clients from './pages/Clients'
import Projects from './pages/Projects'
import Timer from './pages/Timer'
import Reports from './pages/Reports'

function PrivateRoute({ children }) {
  return pb.authStore.isValid ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Navigate to="/timer" replace />} />
        <Route path="timer" element={<Timer />} />
        <Route path="clients" element={<Clients />} />
        <Route path="projects" element={<Projects />} />
        <Route path="reports" element={<Reports />} />
      </Route>
    </Routes>
  )
}
