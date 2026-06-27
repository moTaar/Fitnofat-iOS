import { useEffect, useState } from "react";
import { setCredentials } from "./api";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

export default function App() {
  const [authed, setAuthed] = useState(false);

  // Restore saved credentials on load.
  useEffect(() => {
    const url = localStorage.getItem("admin_url");
    const key = localStorage.getItem("admin_key");
    if (url && key) {
      setCredentials(url, key);
      setAuthed(true);
    }
  }, []);

  function handleLogout() {
    localStorage.removeItem("admin_url");
    localStorage.removeItem("admin_key");
    setAuthed(false);
  }

  return authed
    ? <Dashboard onLogout={handleLogout} />
    : <Login onLogin={() => setAuthed(true)} />;
}
