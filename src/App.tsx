import { type FC, useState, useCallback } from 'react';
import './styles/global.css';
import { AppShell } from './components/layout/AppShell';
import { HomePage } from './components/pages/HomePage';
import { SearchPage } from './components/pages/SearchPage';
import { LibraryPage } from './components/pages/LibraryPage';
import { ExplorePage } from './components/pages/ExplorePage';
import { SettingsPage } from './components/pages/SettingsPage';
import { LoginPage } from './components/pages/LoginPage';

const App: FC = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentPath, setCurrentPath] = useState('home');
  const [isNowPlayingOpen, setIsNowPlayingOpen] = useState(false);

  const toggleNowPlaying = useCallback(() => {
    setIsNowPlayingOpen((prev) => !prev);
  }, []);

  if (!isLoggedIn) {
    return <LoginPage onLoggedIn={() => setIsLoggedIn(true)} />;
  }

  const renderPage = () => {
    if (currentPath === 'search') return <SearchPage />;
    if (currentPath === 'explore') return <ExplorePage />;
    if (currentPath === 'settings') return <SettingsPage />;
    if (currentPath.startsWith('library')) return <LibraryPage />;
    return <HomePage />;
  };

  return (
    <AppShell
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      nowPlayingOpen={isNowPlayingOpen}
      onToggleNowPlaying={toggleNowPlaying}
    >
      {renderPage()}
    </AppShell>
  );
};

export default App;
