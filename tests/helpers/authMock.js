// Stand-in for src/context/AuthContext.jsx so components can be tested in any auth state.
//   vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
import { vi } from 'vitest'

const base = () => ({
  configured: true,
  loading: false,
  session: null,
  user: null,
  profile: null,
  role: null,
  signIn: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
  signOut: vi.fn(async () => {}),
  refreshProfile: vi.fn(),
})

let state = base()
export const useAuth = () => state
export const AuthProvider = ({ children }) => children
export const setAuth = (patch = {}) => { state = { ...base(), ...patch }; return state }
export const asRole = (role, extra = {}) =>
  setAuth({
    user: { id: 'u1', email: 'u@example.com' },
    session: {},
    profile: { id: 'u1', full_name: 'Test User', phone: '9876543210', role, is_active: true },
    role,
    ...extra,
  })
