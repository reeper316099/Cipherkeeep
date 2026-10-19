import { useEffect } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { CommandLibrary } from './features/commands/CommandLibrary';
import { ConceptsPage } from './features/concepts/ConceptsPage';
import { GraphPage } from './features/graph/GraphPage';
import { Dashboard } from './features/dashboard/Dashboard';
import { ComingSoon } from './features/Home';
import { LabsPage } from './features/labs/LabsPage';
import { LogPage } from './features/log/LogPage';
import { NotesPage } from './features/notes/NotesPage';
import { ProjectsPage } from './features/projects/ProjectsPage';
import { QuestionsPage } from './features/questions/QuestionsPage';
import { StudyPage } from './features/study/StudyPage';
import { SnippetsPage } from './features/snippets/SnippetsPage';
import { ImportPage } from './features/import/ImportPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useSettings } from './lib/queries';
import { applyTheme } from './lib/theme';

function ThemeSync() {
  const { data } = useSettings();
  useEffect(() => {
    if (!data) return;
    applyTheme(data);
    if (data.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme(data);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [data]);
  return null;
}

export function App() {
  return (
    <HashRouter>
      <ThemeSync />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="commands/:id?" element={<CommandLibrary />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="study" element={<StudyPage />} />
          <Route path="questions" element={<QuestionsPage />} />
          <Route path="concepts/:id?" element={<ConceptsPage />} />
          <Route path="labs/:id?" element={<LabsPage />} />
          <Route path="projects/:id?" element={<ProjectsPage />} />
          <Route path="log/:id?" element={<LogPage />} />
          <Route path="notes/:id?" element={<NotesPage />} />
          <Route path="snippets/:id?" element={<SnippetsPage />} />
          <Route path="*" element={<ComingSoon title="Not found" milestone="—" />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
