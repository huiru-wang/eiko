import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import { Routes } from './lib/router';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App><Routes /></App></React.StrictMode>);
