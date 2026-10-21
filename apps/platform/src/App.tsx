import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { GamePage } from './pages/GamePage';
import { Lobby } from './pages/Lobby';
import { NotFound } from './pages/NotFound';

export default function App() {
  return (
    <BrowserRouter>
      <div className="atmosphere" aria-hidden="true">
        <div className="atmo-glow atmo-glow-1" />
        <div className="atmo-glow atmo-glow-2" />
        <div className="atmo-grid" />
      </div>
      <Header />
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/play/:gameId" element={<GamePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
