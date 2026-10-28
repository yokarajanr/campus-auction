import { BrowserRouter, Link, NavLink, Route, Routes } from 'react-router-dom';
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

function Header() {
  const { user, logout } = useAuth();
  return (
    <header className="header">
      <div className="container header-inner">
        <Link to="/" className="brand">Campus Auction</Link>
        <nav>
          <NavLink to="/" end>Browse</NavLink>
          <NavLink to="/sell">Sell</NavLink>
          {user && <NavLink to="/my-listings">My listings</NavLink>}
          {user && <NavLink to="/my-bids">My bids</NavLink>}
          {user && <NavLink to="/wanted">Wanted</NavLink>}
          {user && <NavLink to="/assistant">Assistant</NavLink>}
        </nav>
        <div className="user">
          {user ? (
            <>
              <NotificationBell />
              <span>Hi, {user.name}</span>
              <button className="btn small" onClick={logout}>Log out</button>
            </>
          ) : (
            <Link className="btn small primary" to="/login">Log in</Link>
          )}
        </div>
      </div>
    </header>
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
      </AuthProvider>
    </BrowserRouter>
  );
}
