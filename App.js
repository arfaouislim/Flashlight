import React, { useState, useEffect, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  StatusBar,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Power, Zap, Sun, Send, Activity } from "lucide-react-native";
import {
  BannerAd,
  BannerAdSize,
  TestIds,
  InterstitialAd,
  AdEventType,
} from "react-native-google-mobile-ads";

const MORSE_CODE = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  1: ".----",
  2: "..---",
  3: "...--",
  4: "....-",
  5: ".....",
  6: "-....",
  7: "--...",
  8: "---..",
  9: "----.",
  0: "-----",
  " ": " ",
};

// Use Google's test banner while developing so you never trigger invalid
// traffic warnings on your own AdMob account; swap to your real unit ID
// automatically in a production build.
const adUnitId = __DEV__
  ? TestIds.BANNER
  : "ca-app-pub-5296467128204489/3318481793";

const interstitialAdUnitId = __DEV__
  ? TestIds.INTERSTITIAL
  : "ca-app-pub-5296467128204489/1492132910";

const interstitial = InterstitialAd.createForAdRequest(interstitialAdUnitId, {
  requestNonPersonalizedAdsOnly: true,
});

export default function App() {
  const [interstitialLoaded, setInterstitialLoaded] = useState(false);
  const [pendingMorseMode, setPendingMorseMode] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [activeMode, setActiveMode] = useState("torch");
  const [isLightOn, setIsLightOn] = useState(false);
  const [hardwareTorch, setHardwareTorch] = useState(false);
  const [sliderVal, setSliderVal] = useState(18); // Value from 1 to 35
  const [morseText, setMorseText] = useState("");
  const [isTransmitting, setIsTransmitting] = useState(false);

  const timeoutRefs = useRef([]);
  const sosIntervalRef = useRef(null);
  const sliderWidthRef = useRef(0);

  // Staggered Ripple Animators
  const ringAnim1 = useRef(new Animated.Value(0)).current;
  const ringAnim2 = useRef(new Animated.Value(0)).current;
  const ringAnim3 = useRef(new Animated.Value(0)).current;
  const animTimeouts = useRef([]);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  // Bulletproof infinite looping using independent Animated.loop sequences staggered by JS Timeouts
  useEffect(() => {
    // 1. Clear any active timeouts & animation references
    animTimeouts.current.forEach(clearTimeout);
    animTimeouts.current = [];

    ringAnim1.stopAnimation();
    ringAnim2.stopAnimation();
    ringAnim3.stopAnimation();

    ringAnim1.setValue(0);
    ringAnim2.setValue(0);
    ringAnim3.setValue(0);

    // 2. Restart animation loops from scratch only if flashlight is actively turned ON
    if (isLightOn && activeMode !== "morse") {
      const t1 = setTimeout(() => {
        Animated.loop(
          Animated.timing(ringAnim1, {
            toValue: 1,
            duration: 2200,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ).start();
      }, 0);

      const t2 = setTimeout(() => {
        Animated.loop(
          Animated.timing(ringAnim2, {
            toValue: 1,
            duration: 2200,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ).start();
      }, 733); // Perfect 1/3 split offset

      const t3 = setTimeout(() => {
        Animated.loop(
          Animated.timing(ringAnim3, {
            toValue: 1,
            duration: 2200,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
        ).start();
      }, 1466); // Perfect 2/3 split offset

      animTimeouts.current = [t1, t2, t3];
    }

    return () => {
      animTimeouts.current.forEach(clearTimeout);
      ringAnim1.stopAnimation();
      ringAnim2.stopAnimation();
      ringAnim3.stopAnimation();
    };
  }, [isLightOn, activeMode]);

  useEffect(() => {
    const unsubscribeLoaded = interstitial.addAdEventListener(
      AdEventType.LOADED,
      () => {
        console.log("Interstitial ad loaded");
        setInterstitialLoaded(true);

        // If the user pressed Morse while the ad was loading,
        // show it now.
        if (pendingMorseMode) {
          interstitial.show();
          setPendingMorseMode(false);
        }
      },
    );

    const unsubscribeClosed = interstitial.addAdEventListener(
      AdEventType.CLOSED,
      () => {
        console.log("Interstitial ad closed");

        setInterstitialLoaded(false);

        // Enter Morse mode after the ad closes
        setActiveMode("morse");
        setIsLightOn(false);

        // Preload the next interstitial
        interstitial.load();
      },
    );

    const unsubscribeError = interstitial.addAdEventListener(
      AdEventType.ERROR,
      (error) => {
        console.log("Interstitial error:", error);

        setInterstitialLoaded(false);
        setPendingMorseMode(false);

        // Even if the ad fails, let the user use Morse mode
        setActiveMode("morse");
        setIsLightOn(false);
      },
    );

    // Load the first interstitial when the app starts
    interstitial.load();

    return () => {
      unsubscribeLoaded();
      unsubscribeClosed();
      unsubscribeError();
    };
  }, [pendingMorseMode]);

  // Map slider scale directly to a functional flash frequency delay rate
  const getSosDelay = (value) => Math.max(80, 600 - value * 14);
  // Calculate a visual frequency presentation value in Hertz (Hz)
  const getSosHz = (value) => (1000 / (getSosDelay(value) * 2)).toFixed(1);

  // Manage Flashlight Hardware Engine State Loops
  useEffect(() => {
    clearInterval(sosIntervalRef.current);
    timeoutRefs.current.forEach(clearTimeout);
    timeoutRefs.current = [];
    setIsTransmitting(false);

    if (!isLightOn) {
      setHardwareTorch(false);
      return;
    }

    if (activeMode === "torch") {
      setHardwareTorch(true);
    } else if (activeMode === "sos") {
      const pulseSpeedMs = getSosDelay(sliderVal);
      let state = true;
      setHardwareTorch(true);
      sosIntervalRef.current = setInterval(() => {
        state = !state;
        setHardwareTorch(state);
      }, pulseSpeedMs);
    }
  }, [isLightOn, activeMode, sliderVal]);

  useEffect(() => {
    return () => {
      clearInterval(sosIntervalRef.current);
      timeoutRefs.current.forEach(clearTimeout);
    };
  }, []);

  const transmitMorse = async () => {
    if (isTransmitting || !morseText.trim()) return;
    setIsTransmitting(true);
    setIsLightOn(false);

    const textToTransmit = morseText.toUpperCase();
    let delay = 0;
    const DOT_DURATION = 200;
    const DASH_DURATION = DOT_DURATION * 3;

    const addPulse = (duration) => {
      const turnOn = setTimeout(() => setHardwareTorch(true), delay);
      delay += duration;
      const turnOff = setTimeout(() => setHardwareTorch(false), delay);
      delay += DOT_DURATION;
      timeoutRefs.current.push(turnOn, turnOff);
    };

    for (let char of textToTransmit) {
      const code = MORSE_CODE[char];
      if (code === " ") {
        delay += DOT_DURATION * 4;
      } else if (code) {
        for (let element of code) {
          if (element === ".") addPulse(DOT_DURATION);
          if (element === "-") addPulse(DASH_DURATION);
        }
        delay += DOT_DURATION * 2;
      }
    }

    const finalCleanup = setTimeout(() => {
      setIsTransmitting(false);
    }, delay);
    timeoutRefs.current.push(finalCleanup);
  };

  const handleSliderTouch = (evt) => {
    const touchX = evt.nativeEvent.locationX;
    if (sliderWidthRef.current > 0) {
      const percentage = Math.max(
        0,
        Math.min(1, touchX / sliderWidthRef.current),
      );
      const calculatedTick = Math.max(1, Math.round(percentage * 35));
      setSliderVal(calculatedTick);
    }
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: handleSliderTouch,
      onPanResponderMove: handleSliderTouch,
    }),
  ).current;

  // High visibility interpolation curves for ripple waves
  const getRippleStyle = (animatedValue) => {
    return {
      transform: [
        {
          scale: animatedValue.interpolate({
            inputRange: [0, 1],
            outputRange: [1.0, 1.85],
          }),
        },
      ],
      opacity: animatedValue.interpolate({
        inputRange: [0, 0.1, 0.7, 1],
        outputRange: [0, 0.9, 0.5, 0],
      }),
    };
  };

  if (!permission) {
    return (
      <View style={styles.centerTextContainer}>
        <ActivityIndicator size="large" color="#FFC700" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.centerTextContainer}>
        <Text
          style={{
            fontWeight: "bold",
            color: "#000",
            marginBottom: 20,
            textAlign: "center",
          }}
        >
          Camera/Flash permission is required to use Flashlight App.
        </Text>
        <TouchableOpacity
          style={styles.permissionBtn}
          onPress={requestPermission}
        >
          <Text style={{ fontWeight: "bold", color: "#000" }}>
            Grant Permission
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar barStyle="dark-content" backgroundColor="#FFF" />

        <CameraView
          style={{ position: "absolute", width: 1, height: 1 }}
          enableTorch={hardwareTorch}
          facing="back"
        />

        <View style={styles.header}>
          <Text style={styles.headerTitle}>Flashlight</Text>
        </View>

        {/* Mode Buttons */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[
              styles.modeButton,
              activeMode === "sos" && styles.modeActive,
            ]}
            onPress={() => {
              setActiveMode("sos");
              setIsLightOn(false);
            }}
          >
            <Text style={styles.modeText}>SOS</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeButton,
              activeMode === "torch" && styles.modeActive,
            ]}
            onPress={() => {
              setActiveMode("torch");
            }}
          >
            <Zap
              size={22}
              color="#000"
              fill={activeMode === "torch" ? "#000" : "none"}
            />
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.modeButton,
              activeMode === "morse" && styles.modeActive,
            ]}
            onPress={() => {
              if (interstitialLoaded) {
                // Ad already ready: show immediately
                interstitial.show();
              } else {
                // Ad not ready: remember that the user wants Morse mode
                setPendingMorseMode(true);

                // Start loading the ad
                interstitial.load();
              }
            }}
          >
            <Text style={styles.modeText}>Morse</Text>
          </TouchableOpacity>
        </View>

        {/* Main Workspace Frame */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.centerCanvasContainer}
        >
          {activeMode === "morse" ? (
            <View style={styles.morsePanel}>
              <Text style={styles.morseInstruction}>
                Type a message to flash in Morse Code:
              </Text>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.morseInput}
                  placeholder="SOS, HELLO, etc..."
                  placeholderTextColor="#C7C7CC"
                  value={morseText}
                  onChangeText={setMorseText}
                  editable={!isTransmitting}
                  maxLength={20}
                />
                <TouchableOpacity
                  style={[
                    styles.sendButton,
                    isTransmitting && styles.sendButtonDisabled,
                  ]}
                  onPress={transmitMorse}
                  disabled={isTransmitting}
                >
                  {isTransmitting ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Send size={20} color="#000" />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.centerVisualArea}>
              {/* Infinite High-Impact Ripple Layers */}
              {isLightOn && (
                <View style={styles.rippleAbsoluteContainer}>
                  <Animated.View
                    style={[styles.pulsingRing, getRippleStyle(ringAnim1)]}
                  />
                  <Animated.View
                    style={[styles.pulsingRing, getRippleStyle(ringAnim2)]}
                  />
                  <Animated.View
                    style={[styles.pulsingRing, getRippleStyle(ringAnim3)]}
                  />
                </View>
              )}

              {/* Central Fixed Trigger Circle */}
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setIsLightOn(!isLightOn)}
                style={[
                  styles.mainPowerButton,
                  isLightOn && styles.mainPowerActive,
                ]}
              >
                <Power size={52} color="#1C1C1E" strokeWidth={2.2} />
              </TouchableOpacity>
            </View>
          )}
        </KeyboardAvoidingView>

        {/* Contextual Slider Area (Hidden on Morse) */}
        {activeMode !== "morse" && (
          <View style={styles.sliderWrapper}>
            <View
              style={styles.tickTrack}
              onLayout={(event) => {
                sliderWidthRef.current = event.nativeEvent.layout.width;
              }}
              {...panResponder.panHandlers}
            >
              {Array.from({ length: 35 }).map((_, index) => (
                <View
                  key={index}
                  pointerEvents="none"
                  style={[
                    styles.tickElement,
                    index < sliderVal ? styles.tickActive : styles.tickInactive,
                  ]}
                />
              ))}
            </View>

            <View style={styles.sliderIndicatorRow}>
              <Text style={styles.sliderContextLabel}>
                {activeMode === "sos"
                  ? "⚡ STROBE FREQUENCY"
                  : "🔅 BRIGHTNESS INTENSITY"}
              </Text>

              {activeMode === "sos" ? (
                <View style={styles.valueBadgeContainer}>
                  <Activity
                    size={14}
                    color="#FFC700"
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.valueBadgeText}>
                    {getSosHz(sliderVal)} Hz
                  </Text>
                </View>
              ) : (
                <View style={styles.valueBadgeContainer}>
                  <Sun size={14} color="#FFC700" style={{ marginRight: 4 }} />
                  <Text style={styles.valueBadgeText}>
                    {Math.round((sliderVal / 35) * 100)}%
                  </Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Banner Ad */}
        <View style={styles.admobPlacementContainer}>
          <BannerAd
            unitId={adUnitId}
            size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
            requestOptions={{ requestNonPersonalizedAdsOnly: true }}
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  centerTextContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 20,
  },
  permissionBtn: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: "#FFC700",
    borderRadius: 25,
  },
  header: { alignItems: "center", marginTop: 20, marginBottom: 10 },
  headerTitle: { fontSize: 24, fontWeight: "500", color: "#1C1C1E" },
  modeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 35,
    marginVertical: 20,
  },
  modeButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#FFC700",
    opacity: 0.3,
    justifyContent: "center",
    alignItems: "center",
  },
  modeActive: { opacity: 1 },
  modeText: { fontSize: 13, fontWeight: "bold", color: "#000" },
  centerCanvasContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
  },
  centerVisualArea: {
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },

  // High Visibility Ripple Layers (Tuned Opacities)
  rippleAbsoluteContainer: {
    position: "absolute",
    width: 160,
    height: 160,
    justifyContent: "center",
    alignItems: "center",
    zIndex: -1,
  },
  pulsingRing: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#FFEB60",
  },

  // Fixed Base Button Layout
  mainPowerButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#E5E5EA",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#D1D1D6",
    zIndex: 5,
  },
  mainPowerActive: {
    backgroundColor: "#FFC700",
    borderColor: "#E6B200",
    shadowColor: "#FFC700",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },

  sliderWrapper: { paddingHorizontal: 40, marginBottom: 20, marginTop: 10 },
  tickTrack: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: 40,
    width: "100%",
    backgroundColor: "transparent",
  },
  tickElement: { width: 3, height: 22, borderRadius: 1.5 },
  tickActive: { backgroundColor: "#FFC700" },
  tickInactive: { backgroundColor: "#E5E5EA" },
  sliderIndicatorRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
    marginTop: 4,
  },
  sliderContextLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#A3A3A3",
    letterSpacing: 0.5,
  },

  // Dynamic Presentation Badges
  valueBadgeContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F2F2F7",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  valueBadgeText: { fontSize: 12, fontWeight: "700", color: "#1C1C1E" },

  morsePanel: { width: "80%", alignItems: "center" },
  morseInstruction: {
    color: "#8E8E93",
    fontSize: 14,
    marginBottom: 15,
    textAlign: "center",
  },
  inputContainer: {
    flexDirection: "row",
    width: "100%",
    height: 50,
    backgroundColor: "#F2F2F7",
    borderRadius: 25,
    paddingLeft: 20,
    alignItems: "center",
    overflow: "hidden",
  },
  morseInput: { flex: 1, color: "#000", fontSize: 16, fontWeight: "500" },
  sendButton: {
    width: 50,
    height: 50,
    backgroundColor: "#FFC700",
    justifyContent: "center",
    alignItems: "center",
  },
  sendButtonDisabled: { backgroundColor: "#E5E5EA" },

  // Ad Buffer View Spacing
  admobPlacementContainer: {
    width: "100%",
    minHeight: 62,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderColor: "#E5E5EA",
    justifyContent: "center",
    alignItems: "center",
  },
  admobDebugLabel: {
    fontSize: 9,
    color: "#C7C7CC",
    fontWeight: "700",
    letterSpacing: 1,
  },
});
