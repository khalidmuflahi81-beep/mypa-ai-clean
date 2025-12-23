import React, { useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
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

  const start = async () => {
    try {
      setDebug("");
      setTranscript("");
      setReply("");
      setStatus("Requesting permission...");

      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setStatus("Mic permission denied");
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
    }
  };

  const stop = async () => {
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

      if (!uri) {
        setStatus("No audio captured");
        return;
      }

      // ✅ New job-based flow
      setStatus("Uploading...");
      const startResp = await sendAudioToBackend(uri);

      if (startResp.error) throw new Error(startResp.error);
      if (!startResp.jobId) throw new Error("No jobId returned from backend");

      setStatus("Transcribing...");
      const result = await pollJob(startResp.jobId);

      setTranscript(result.transcript || "");
      setReply(result.reply || "");
      setStatus("Done ✅");

      if (result.reply) {
        Speech.stop();
        Speech.speak(result.reply, { language: "en-US" });
      }
    } catch (e) {
      setStatus("Error");
      setDebug(String(e?.message || e));
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

  const statusTone = useMemo(() => deriveStatusTone(status), [status]);

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>MyPA AI</Text>
          <Text style={styles.subtitle}>
            Hold the mic to capture your voice, then review the transcript and
            AI reply.
          </Text>
        </View>

        <View style={styles.statusRow}>
          <StatusBadge status={status} tone={statusTone} styles={styles} />
          <View style={styles.statusMeta}>
            <Text style={styles.metaLabel}>Mic tip</Text>
            <Text style={styles.metaValue}>
              {Platform.OS === "ios"
                ? "Settings → Microphone → Expo Go must be ON"
                : "App Permissions → Microphone must be Allowed"}
            </Text>
          </View>
        </View>

        <View style={styles.grid}>
          <InfoCard
            label="Transcript"
            body={transcript}
            placeholder="Your voice-to-text transcript will appear here."
            onCopy={() => copyText(transcript, "Transcript")}
            onShare={() => shareText(transcript, "Transcript")}
            styles={styles}
          />
          <InfoCard
            label="Reply"
            body={reply}
            placeholder="The AI response will show up once processing finishes."
            onCopy={() => copyText(reply, "Reply")}
            onShare={() => shareText(reply, "Reply")}
            styles={styles}
          />
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
          <Text style={styles.micLabel}>Hold to talk</Text>
        </Pressable>

        {!!debug && <Text style={styles.debug}>Debug: {debug}</Text>}
      </View>
    </View>
  );
}

function InfoCard({ label, body, placeholder, onCopy, onShare, styles }) {
  const hasContent = Boolean(body);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeading}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{hasContent ? "Ready" : "Pending"}</Text>
        </View>
      </View>

      <Text style={styles.body}>{body || placeholder}</Text>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Copy ${label.toLowerCase()}`}
          onPress={onCopy}
          disabled={!hasContent}
          style={[
            styles.actionButton,
            !hasContent && styles.actionButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.actionText,
              !hasContent && styles.actionTextDisabled,
            ]}
          >
            Copy
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Share ${label.toLowerCase()}`}
          onPress={onShare}
          disabled={!hasContent}
          style={[
            styles.actionButton,
            !hasContent && styles.actionButtonDisabled,
          ]}
        >
          <Text
            style={[
              styles.actionText,
              !hasContent && styles.actionTextDisabled,
            ]}
          >
            Share
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function StatusBadge({ status, tone, styles }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: tone.background }]}>
      <Text style={[styles.status, { color: tone.text }]}>
        {tone.icon} {status}
      </Text>
    </View>
  );
}

function deriveStatusTone(status) {
  const normalized = status.toLowerCase();

  if (normalized.includes("recording")) {
    return { background: "#fff4e5", text: "#8a4500", icon: "⏺️" };
  }
  if (normalized.includes("upload") || normalized.includes("transcrib")) {
    return { background: "#e8f0fe", text: "#0b1f33", icon: "⏳" };
  }
  if (normalized.includes("done")) {
    return { background: "#e6f4ea", text: "#0f5132", icon: "✅" };
  }
  if (normalized.includes("error")) {
    return { background: "#fdecea", text: "#8a1c1c", icon: "⚠️" };
  }

  return { background: "#eef2f7", text: "#0b1f33", icon: "🎙️" };
}

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
      gap: scale(12),
    },
    header: {
      gap: scale(6),
    },
    title: {
      fontSize: scale(24),
      fontWeight: "700",
      marginBottom: scale(4),
      color: "#0b1f33",
    },
    subtitle: {
      fontSize: scale(15),
      lineHeight: scale(20),
      color: "#243447",
    },
    statusRow: {
      flexDirection: "row",
      gap: scale(12),
      alignItems: "center",
    },
    statusMeta: {
      flex: 1,
      backgroundColor: "#f4f6fa",
      borderRadius: 12,
      paddingHorizontal: scale(12),
      paddingVertical: scale(10),
      borderWidth: 1,
      borderColor: "#e1e7ef",
      gap: scale(4),
    },
    metaLabel: {
      fontSize: scale(12),
      color: "#6b7280",
      fontWeight: "600",
      letterSpacing: 0.2,
    },
    metaValue: {
      fontSize: scale(14),
      color: "#0b1f33",
    },
    grid: {
      gap: scale(12),
    },
    card: {
      borderWidth: 1,
      borderColor: "#d0d7e2",
      borderRadius: 14,
      padding: scale(14),
      backgroundColor: "#f9fbff",
      shadowColor: "#0b1f33",
      shadowOpacity: 0.03,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 2,
    },
    cardHeading: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: scale(4),
    },
    badge: {
      borderRadius: 999,
      backgroundColor: "#e8f0fe",
      paddingHorizontal: scale(10),
      paddingVertical: scale(4),
    },
    badgeText: {
      fontSize: scale(12),
      color: "#0b1f33",
      fontWeight: "600",
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
      flex: 1,
    },
    actionButtonDisabled: {
      backgroundColor: "#eef2f7",
      borderColor: "#d5d9de",
      borderWidth: 1,
    },
    actionText: {
      fontSize: scale(14),
      fontWeight: "600",
      color: "#0b1f33",
    },
    actionTextDisabled: {
      color: "#9aa4b5",
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
      gap: scale(14),
    },
    mic: {
      alignSelf: "center",
      width: Math.max(96, scale(88)),
      minWidth: 48,
      borderRadius: Math.max(48, scale(44)),
      backgroundColor: "#0066cc",
      alignItems: "center",
      justifyContent: "center",
      shadowColor: "#000",
      shadowOpacity: 0.1,
      shadowOffset: { width: 0, height: 4 },
      shadowRadius: 8,
      elevation: 4,
      paddingVertical: scale(14),
      paddingHorizontal: scale(18),
      gap: scale(6),
    },
    micPressed: {
      backgroundColor: "#0055aa",
    },
    micText: {
      fontSize: scale(38),
      color: "#ffffff",
    },
    micLabel: {
      fontSize: scale(14),
      color: "#e5ecf6",
      fontWeight: "600",
    },
    statusPill: {
      borderRadius: 999,
      paddingHorizontal: scale(14),
      paddingVertical: scale(10),
      alignSelf: "center",
      borderWidth: 1,
      borderColor: "#d5dbe7",
    },
    status: {
      textAlign: "center",
      fontSize: scale(15),
      fontWeight: "600",
    },
    debug: {
      marginTop: scale(8),
      fontSize: scale(12),
      color: "#0b1f33",
      textAlign: "center",
    },
  });
};
