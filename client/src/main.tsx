import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Full-width bands use 100vw, which includes the scrollbar; expose its width so they line up with the page.
const setScrollbarWidth = () =>
  document.documentElement.style.setProperty('--sbw', `${window.innerWidth - document.documentElement.clientWidth}px`);
setScrollbarWidth();
window.addEventListener('resize', setScrollbarWidth);
new ResizeObserver(setScrollbarWidth).observe(document.body);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
