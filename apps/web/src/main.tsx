import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './index.css';
import { Providers } from './app/providers';
import { router } from './app/router';

const container = document.getElementById('root');
if (!container) throw new Error('Falta el elemento #root en index.html');

createRoot(container).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
