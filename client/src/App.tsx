import { useEffect, useRef, useState } from 'react';
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, RequireAuth, useAuth } from './auth';
import { Browse } from './pages/Browse';
import { Login } from './pages/Login';
import { Sell } from './pages/Sell';
import { AuctionPage } from './pages/AuctionPage';
import { MyListings } from './pages/MyListings';
import { MyBids } from './pages/MyBids';
import { Wanted } from './pages/Wanted';
import { Assistant } from './pages/Assistant';
import { NotificationBell } from './components/NotificationBell';

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!user) return null;
  const initials = user.name.replace(/\(.*?\)/g, '').split(/\s+/).filter((w) => /^[a-z]/i.test(w))
    .map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

  return (
    <div className="menu-wrap" ref={menu}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account menu">
        <span className="avatar">{initials}</span>
        <span className="avatar-name">{user.name}</span>
      </button>
      {open && (
        <div className="menu">
          <p className="menu-head">Signed in as<br /><strong>{user.name}</strong></p>
          <Link to="/my-listings">My listings</Link>
          <Link to="/my-bids">My bids</Link>
          <Link to="/wanted">Saved searches</Link>
          <button onClick={logout}>Log out</button>
        </div>
      )}
    </div>
  );
}

function Header() {
  const { user } = useAuth();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand"><span className="brand-mark">CA</span><span className="brand-name">Campus Auction</span></Link>
        <nav>
          <NavLink to="/" end>Browse</NavLink>
          {user && <NavLink to="/my-bids">My bids</NavLink>}
          {user && <NavLink to="/wanted">Wanted</NavLink>}
          {user && <NavLink to="/assistant">Assistant</NavLink>}
        </nav>
        <div className="user">
          <Link className="btn primary sell-btn" to="/sell"><span className="plus">+</span><span className="sell-label">Sell an item</span></Link>
          {user ? (
            <>
              <NotificationBell />
              <UserMenu />
            </>
          ) : (
            <Link className="btn" to="/login">Log in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span><strong>Campus Auction</strong> · Fair, public auctions for campus items.</span>
        <span className="muted">Every bid is public. Every item has its own timer. Handover happens on campus.</span>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Header />
        <main className="container">
          <Routes>
            <Route path="/" element={<Browse />} />
            <Route path="/login" element={<Login />} />
            <Route path="/auctions/:id" element={<AuctionPage />} />
            <Route path="/sell" element={<RequireAuth><Sell key="new" /></RequireAuth>} />
            <Route path="/auctions/:id/edit" element={<RequireAuth><Sell key="edit" /></RequireAuth>} />
            <Route path="/my-listings" element={<RequireAuth><MyListings /></RequireAuth>} />
            <Route path="/my-bids" element={<RequireAuth><MyBids /></RequireAuth>} />
            <Route path="/wanted" element={<RequireAuth><Wanted /></RequireAuth>} />
            <Route path="/assistant" element={<RequireAuth><Assistant /></RequireAuth>} />
            <Route path="*" element={<p className="muted">Page not found.</p>} />
          </Routes>
        </main>
        <Footer />
      </AuthProvider>
    </BrowserRouter>
  );
}
