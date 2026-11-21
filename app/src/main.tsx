import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/500.css';
import '@fontsource/dm-sans/600.css';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/400-italic.css';
import '@fontsource/spectral/600.css';
import './index.css';
import Home from './pages/Home';
import Course from './pages/Course';
import Assignment from './pages/Assignment';
import History from './pages/History';
import Settings from './pages/Settings';
import { ensureSession } from './lib/api';

ensureSession().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/courses/:id" element={<Course />} />
          <Route path="/assignments/:id" element={<Assignment />} />
          <Route path="/assignments/:id/:stage" element={<Assignment />} />
          <Route path="/documents/:id/history" element={<History />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </BrowserRouter>
    </React.StrictMode>,
  );
});
