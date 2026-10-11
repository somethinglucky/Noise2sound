import { useCallback, useState } from "react";
import HomeScreen from "./screens/HomeScreen";
import RecordScreen from "./screens/RecordScreen";
import EditorScreen from "./screens/EditorScreen";
import { makeClip, type Clip } from "./audio/clip";
import { FREE_CLIP_SECONDS } from "./config";

type Screen = "home" | "record" | "editor";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [clip, setClip] = useState<Clip | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const openBlob = useCallback(async (name: string, blob: Blob) => {
    setMessage(null);
    try {
      const next = await makeClip(name, blob);
      if (next.durationSeconds > FREE_CLIP_SECONDS + 0.25) {
        setScreen("home");
        setMessage(
          `That clip is ${next.durationSeconds.toFixed(1)}s. Free clips can be up to ${FREE_CLIP_SECONDS}s. Premium will remove the limit.`,
        );
        return;
      }
      setClip(next);
      setScreen("editor");
    } catch {
      setScreen("home");
      setMessage("Couldn't read that audio. Try a different file or record a new clip.");
    }
  }, []);

  return (
    <main className="app">
      {screen === "home" && (
        <HomeScreen
          message={message}
          onRecord={() => {
            setMessage(null);
            setScreen("record");
          }}
          onUpload={(file) => void openBlob(file.name.replace(/\.[^.]+$/, ""), file)}
        />
      )}
      {screen === "record" && (
        <RecordScreen onBack={() => setScreen("home")} onRecorded={(blob) => void openBlob("Recording", blob)} />
      )}
      {screen === "editor" && clip && (
        <EditorScreen
          clip={clip}
          onClose={() => {
            setClip(null);
            setScreen("home");
          }}
        />
      )}
    </main>
  );
}
