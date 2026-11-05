import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'

import AppHeader from '@/components/layout/AppHeader'
import { useTheme } from '@/hooks/useTheme'
import KnowledgeGraphsPage from '@/pages/KnowledgeGraphsPage'
import UploadPage from '@/pages/UploadPage'
import ModelingPage from '@/pages/ModelingPage'
import ExtractionPage from '@/pages/ExtractionPage'
import ReviewPage from '@/pages/ReviewPage'
import GraphEditorPage from '@/pages/GraphEditorPage'
import VersionsPage from '@/pages/VersionsPage'
import AskPage from '@/pages/AskPage'

function Shell() {
  const { theme, toggle } = useTheme()
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader theme={theme} onToggleTheme={toggle} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <Toaster
        theme={theme}
        position="top-center"
        offset={56}
        closeButton
        toastOptions={{
          classNames: {
            toast: 'bg-card! text-foreground! border-border! rounded-md! shadow-none!',
            description: 'text-body-text!'
          }
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Navigate to="/kg" replace />} />
          <Route path="/kg" element={<KnowledgeGraphsPage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/upload/model" element={<ModelingPage />} />
          <Route path="/upload/run" element={<ExtractionPage />} />
          <Route path="/upload/review" element={<ReviewPage />} />
          <Route path="/kg/:id/graph" element={<GraphEditorPage />} />
          <Route path="/kg/:id/versions" element={<VersionsPage />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="*" element={<Navigate to="/kg" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
