import { createHashRouter, Navigate } from 'react-router-dom'
import { AppLayout } from './ui/AppLayout'
import { WorkspacePage } from './workspaces/WorkspacePage'

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Navigate to="/workspaces/default" replace />,
      },
      {
        path: 'workspaces/:workspaceId',
        element: <WorkspacePage />,
      },
    ],
  },
])
