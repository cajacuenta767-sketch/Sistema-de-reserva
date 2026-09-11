import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import './index.css';
import { AuthProvider } from '@/store/auth';
import { ToastProvider } from '@/store/toast';
import { Shell } from '@/components/layout/Shell';
import { RequireAuth } from '@/components/layout/Guard';
import { Home } from '@/pages/Home';
import { Book } from '@/pages/Book';
import { Success } from '@/pages/Success';
import { Login, Register } from '@/pages/Auth';
import { MyBookings } from '@/pages/MyBookings';
import { Notifications } from '@/pages/Notifications';
import { Profile } from '@/pages/Profile';
import { Track } from '@/pages/Track';
import { Agenda } from '@/pages/staff/Agenda';
import { AdminLayout } from '@/pages/admin/Layout';
import { Dashboard } from '@/pages/admin/Dashboard';
import { AdminBookings } from '@/pages/admin/Bookings';
import { AdminServices } from '@/pages/admin/Services';
import { AdminStaff } from '@/pages/admin/Staff';
import { AdminCoupons } from '@/pages/admin/Coupons';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/reservar', element: <Book /> },
      { path: '/login', element: <Login /> },
      { path: '/registro', element: <Register /> },
      { path: '/seguimiento', element: <Track /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/reserva-confirmada/:id', element: <Success /> },
          { path: '/mis-reservas', element: <MyBookings /> },
          { path: '/notificaciones', element: <Notifications /> },
          { path: '/perfil', element: <Profile /> },
        ],
      },
      { element: <RequireAuth roles={['STAFF']} />, children: [{ path: '/staff/agenda', element: <Agenda /> }] },
      {
        element: <RequireAuth roles={['ADMIN']} />,
        children: [
          {
            path: '/admin',
            element: <AdminLayout />,
            children: [
              { index: true, element: <Dashboard /> },
              { path: 'reservas', element: <AdminBookings /> },
              { path: 'servicios', element: <AdminServices /> },
              { path: 'personal', element: <AdminStaff /> },
              { path: 'cupones', element: <AdminCoupons /> },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
);
