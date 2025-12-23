import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Easing,
  ActivityIndicator,
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
  const pulse = useRef(new Animated.Value(0)).current;
  const pulseLoop = useRef(null);

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

  useEffect(() => {
    if (isRecording) {
      pulse.setValue(0);
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulse, {
            toValue: 0,
            duration: 900,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );

      loop.start();
      pulseLoop.current = loop;
    } else if (pulseLoop.current) {
      pulseLoop.current.stop();
      pulseLoop.current = null;
      pulse.setValue(0);
    }
  }, [isRecording, pulse]);

  const micColor = isRecording
    ? "#ff4d6d"
    : isUploading || isTranscribing
    ? "#9aa3b2"
    : "#00c9ff";

  const rippleScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.4],
  });

  const rippleOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.2, 0],
  });

  const handlePressIn = () => {
    if (isUploading || isTranscribing || isRecording) return;
    start();
  };

  const handlePressOut = () => {
    if (isUploading || isTranscribing) return;
    stop();
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

      <View style={styles.micWrapper}>
        {isRecording && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.ripple,
              { opacity: rippleOpacity, transform: [{ scale: rippleScale }] },
            ]}
          />
        )}

        <Pressable
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={({ pressed }) => [
            styles.mic,
            {
              backgroundColor: micColor,
              transform: [{ scale: pressed && !isUploading && !isTranscribing ? 0.96 : 1 }],
              opacity: isUploading || isTranscribing ? 0.65 : 1,
            },
          ]}
          disabled={isUploading || isTranscribing}
        >
          {isUploading || isTranscribing ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.micText}>🎤</Text>
          )}
        </Pressable>
      </View>

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
