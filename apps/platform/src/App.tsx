import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { loadEvaluationSummaries } from './lib/evaluator';
import { loadSummaries } from './lib/ratings';
import { Evaluator } from './pages/Evaluator';
import { GamePage } from './pages/GamePage';
import { Lobby } from './pages/Lobby';
import { NotFound } from './pages/NotFound';
import { Rankings } from './pages/Rankings';

export default function App() {
  useEffect(() => {
    loadSummaries();
    loadEvaluationSummaries();
  }, []);

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
        <Route path="/rankings" element={<Rankings />} />
        <Route path="/evaluator" element={<Evaluator />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
