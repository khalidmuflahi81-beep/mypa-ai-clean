import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
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

  return (
    <View style={styles.container}>
      <Text style={styles.title}>MyPA AI</Text>

      <View style={styles.card}>
        <Text style={styles.label}>Transcript</Text>
        <Text style={styles.body}>{transcript || "..."}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Reply</Text>
        <Text style={styles.body}>{reply || "..."}</Text>
      </View>

      <Pressable onPressIn={start} onPressOut={stop} style={styles.mic}>
        <Text style={styles.micText}>🎤</Text>
      </Pressable>

      <Text style={styles.status}>{status}</Text>

      {!!debug && <Text style={styles.debug}>Debug: {debug}</Text>}

      <Text style={styles.hint}>
        {Platform.OS === "ios"
          ? "iPhone: Settings → Microphone → Expo Go must be ON"
          : "Android: App Permissions → Microphone must be Allowed"}
      </Text>
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
  mic: {
    alignSelf: "center",
    marginTop: 10,
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: "#00c9ff",
    alignItems: "center",
    justifyContent: "center",
  },
  micText: { fontSize: 36, color: "#fff" },
  status: { textAlign: "center", marginTop: 12, fontSize: 14, opacity: 0.75 },
  debug: { marginTop: 10, fontSize: 12, color: "#444" },
  hint: { marginTop: 10, fontSize: 12, opacity: 0.6, textAlign: "center" },
});
