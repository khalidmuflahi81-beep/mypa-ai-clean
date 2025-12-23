  useWindowDimensions,
  Share,
  Clipboard,
} from "react-native";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";

const BACKEND_URL = "https://mypa-ai-backend--khalidmuflahi81.replit.app/voice";

async function sendAudioToBackend(uri) {
  const form = new FormData();

  // iPhone-friendly upload
  form.append("audio", {
    uri,
    name: "voice.m4a",
    type: "audio/m4a",
  });

  const res = await fetch(BACKEND_URL, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
    // IMPORTANT: do NOT set Content-Type manually
  });

  // Read as text first (helps debugging if server returns HTML)
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return json;
  } catch {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function pollJob(jobId) {
  const jobUrl = BACKEND_URL.replace("/voice", `/job/${jobId}`);

  // Poll up to ~90 seconds
  for (let i = 0; i < 90; i++) {
    const res = await fetch(jobUrl, { headers: { Accept: "application/json" } });
    const data = await res.json();

    if (data.status === "done") return data;
    if (data.status === "error") throw new Error(data.error || "Job error");

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error("Timed out waiting for transcription");
}

export default function App() {
  const recRef = useRef(null);
  const { fontScale } = useWindowDimensions();
  const styles = useMemo(() => createStyles(fontScale), [fontScale]);

  const [status, setStatus] = useState("Hold mic to record");
  const [debug, setDebug] = useState("");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);

  const start = async () => {
    if (isUploading || isTranscribing) return;

    try {
      setDebug("");
      setTranscript("");
      setReply("");
      setStatus("Requesting permission...");
      setIsRecording(true);
      setIsUploading(false);
      setIsTranscribing(false);

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setStatus("Mic permission denied");
        setIsRecording(false);
        return;
      }

      setStatus("Setting audio mode...");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
      });

      setStatus("Preparing recorder...");
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(Audio.RecordingOptionsPresets.LOW_QUALITY);

      await rec.startAsync();
      recRef.current = rec;
      setStatus("Recording...");
    } catch (e) {
      setStatus("Recording error");
      setDebug(String(e?.message || e));
      recRef.current = null;
      setIsRecording(false);
    }
  };

  const stop = async () => {
    if (isUploading || isTranscribing) return;

    try {
      const rec = recRef.current;
      if (!rec) {
        setStatus("Nothing to stop");
        return;
      }

      setStatus("Stopping...");
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      recRef.current = null;
      setIsRecording(false);

      if (!uri) {
        setStatus("No audio captured");
        return;
      }

      // ✅ New job-based flow
      setStatus("Uploading...");
      setIsUploading(true);
      const startResp = await sendAudioToBackend(uri);

      if (startResp.error) throw new Error(startResp.error);
      if (!startResp.jobId) throw new Error("No jobId returned from backend");

      setStatus("Transcribing...");
      setIsTranscribing(true);
      const result = await pollJob(startResp.jobId);

      setTranscript(result.transcript || "");
      setReply(result.reply || "");
      setStatus("Done ✅");
      setIsUploading(false);
      setIsTranscribing(false);

      if (result.reply) {
        Speech.stop();
        Speech.speak(result.reply, { language: "en-US" });
      }
    } catch (e) {
      setStatus("Error");
      setDebug(String(e?.message || e));
      setIsUploading(false);
      setIsTranscribing(false);
      setIsRecording(false);
    } finally {
      // Reset mode (helps iOS)
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
      } catch {}
    }
  };

  const copyText = async (text, label) => {
    if (!text) {
      setStatus(`No ${label.toLowerCase()} to copy`);
      return;
    }
    try {
      Clipboard.setString(text);
      setStatus(`${label} copied`);
    } catch (e) {
      setDebug(String(e?.message || e));
      setStatus("Copy failed");
    }
  };

  const shareText = async (text, label) => {
    if (!text) {
      setStatus(`No ${label.toLowerCase()} to share`);
      return;
    }
    try {
      await Share.share({ message: text, title: label });
      setStatus(`${label} shared`);
    } catch (e) {
      setDebug(String(e?.message || e));
      setStatus("Share failed");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>MyPA AI</Text>

        <View style={styles.card}>
          <Text style={styles.label}>Transcript</Text>
          <Text style={styles.body}>{transcript || "..."}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy transcript"
              onPress={() => copyText(transcript, "Transcript")}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Copy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share transcript"
              onPress={() => shareText(transcript, "Transcript")}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Reply</Text>
          <Text style={styles.body}>{reply || "..."}</Text>
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy reply"
              onPress={() => copyText(reply, "Reply")}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Copy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share reply"
              onPress={() => shareText(reply, "Reply")}
              style={styles.actionButton}
            >
              <Text style={styles.actionText}>Share</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hold to record a voice message"
          accessibilityHint="Press and hold to start recording. Release to stop and send."
          onPressIn={start}
          onPressOut={stop}
          style={({ pressed }) => [styles.mic, pressed && styles.micPressed]}
        >
          <Text style={styles.micText}>🎤</Text>
        </Pressable>

        <View style={styles.statusPill}>
          <Text style={styles.status}>{status}</Text>
        </View>

        {!!debug && <Text style={styles.debug}>Debug: {debug}</Text>}

        <Text style={styles.hint}>
          {Platform.OS === "ios"
            ? "iPhone: Settings → Microphone → Expo Go must be ON"
            : "Android: App Permissions → Microphone must be Allowed"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 70, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "700", marginBottom: 16 },
  card: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  label: { fontSize: 12, opacity: 0.7, marginBottom: 6 },
  body: { fontSize: 16 },
  micWrapper: { alignItems: "center", justifyContent: "center", marginTop: 10 },
  mic: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#00c9ff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  micText: { fontSize: 36, color: "#fff" },
  ripple: {
    position: "absolute",
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#ff4d6d",
  },
  status: { textAlign: "center", marginTop: 12, fontSize: 14, opacity: 0.75 },
  debug: { marginTop: 10, fontSize: 12, color: "#444" },
  hint: { marginTop: 10, fontSize: 12, opacity: 0.6, textAlign: "center" },
});
const createStyles = (fontScale) => {
  const scale = (size) => Math.round(size * fontScale);

  return StyleSheet.create({
    container: {
      flex: 1,
      paddingHorizontal: 20,
      paddingTop: scale(56),
      paddingBottom: Math.max(32, scale(36)),
      backgroundColor: "#ffffff",
      justifyContent: "space-between",
    },
    content: {
      flex: 1,
    },
    title: {
      fontSize: scale(24),
      fontWeight: "700",
      marginBottom: scale(16),
      color: "#0b1f33",
    },
    card: {
      borderWidth: 1,
      borderColor: "#d0d7e2",
      borderRadius: 14,
      padding: scale(14),
      marginBottom: scale(12),
      backgroundColor: "#f9fbff",
    },
    actions: {
      marginTop: scale(10),
      flexDirection: "row",
      gap: scale(12),
    },
    actionButton: {
      paddingVertical: scale(10),
      paddingHorizontal: scale(12),
      borderRadius: 10,
      backgroundColor: "#e6eef8",
      minWidth: 48,
      alignItems: "center",
    },
    actionText: {
      fontSize: scale(14),
      fontWeight: "600",
      color: "#0b1f33",
    },
    label: {
      fontSize: scale(13),
      marginBottom: scale(6),
      color: "#243447",
      letterSpacing: 0.2,
    },
    body: {
      fontSize: scale(16),
      lineHeight: scale(22),
      color: "#0b1f33",
    },
    controls: {
      paddingTop: scale(12),
      paddingBottom: Math.max(28, scale(32)),
      alignItems: "center",
      gap: scale(10),
    },
    mic: {
      alignSelf: "center",
      width: Math.max(96, scale(88)),
      height: Math.max(96, scale(88)),
      minWidth: 48,
      minHeight: 48,
      borderRadius: Math.max(48, scale(44)),
      backgroundColor: "#0066cc",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 4,
    },
    micPressed: {
      backgroundColor: "#0055aa",
    },
    micText: {
      fontSize: scale(38),
      color: "#ffffff",
    },
    statusPill: {
      backgroundColor: "#e8f0fe",
      borderRadius: 999,
      paddingHorizontal: scale(14),
      paddingVertical: scale(8),
      alignSelf: "center",
    },
    status: {
      textAlign: "center",
      fontSize: scale(15),
      color: "#0b1f33",
      fontWeight: "600",
    },
    debug: {
      marginTop: scale(4),
      fontSize: scale(12),
      color: "#0b1f33",
      textAlign: "center",
    },
    hint: {
      marginTop: scale(6),
      fontSize: scale(12),
      color: "#1f2937",
      opacity: 0.8,
      textAlign: "center",
      paddingHorizontal: scale(8),
    },
  });
};
