import { BrowserRouter, Route, Routes } from 'react-router';
import { Lobby } from './pages/Lobby';
import { TablePage } from './pages/Table';
import { RoomPage } from './pages/Room';
import { ReplayPage } from './pages/Replay';
import { SpectatePage } from './pages/Spectate';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route path="/table" element={<TablePage />} />
        <Route path="/replay" element={<ReplayPage />} />
        <Route path="/spectate" element={<SpectatePage />} />
      </Routes>
    </BrowserRouter>
  );
}
