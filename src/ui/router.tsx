import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router'
import { AppShell } from './shell/AppShell'
import { LandingPage } from './marketing/LandingPage'
import { OnboardingWizard } from './onboarding/OnboardingWizard'
import { Dashboard } from './pages/Dashboard'
import { SheetsPage } from './pages/SheetsPage'
import { ReportsPage } from './pages/ReportsPage'
import { ClosePage } from './pages/ClosePage'

const rootRoute = createRootRoute({ component: Outlet })

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingWizard,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppShell,
})

const dashboardRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: Dashboard,
})

const sheetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'sheets/$sheetType',
  component: SheetsPage,
})

const reportsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'reports',
  component: ReportsPage,
})

const closeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: 'close',
  component: ClosePage,
})

const routeTree = rootRoute.addChildren([
  landingRoute,
  onboardingRoute,
  appRoute.addChildren([dashboardRoute, sheetsRoute, reportsRoute, closeRoute]),
])

/**
 * History-mode (hash-free) routing. On GitHub Pages the app lives under a
 * repo subpath; basepath comes from Vite's BASE_URL so dev ('/') and Pages
 * ('/Accounting-System/') both work. Deep links survive via public/404.html.
 */
export const router = createRouter({
  routeTree,
  basepath: import.meta.env.BASE_URL,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
