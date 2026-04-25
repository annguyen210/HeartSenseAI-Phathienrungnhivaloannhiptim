import React from "react";
import { SafeAreaView, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#eef4f7" }}>
      <View style={{ padding: 24, gap: 16 }}>
        <Text style={{ color: "#d94b63", fontWeight: "700" }}>HEARTSENSE Mobile</Text>
        <Text style={{ fontSize: 28, fontWeight: "700", color: "#163150" }}>
          Expo/native wrapper scaffold cho iOS va Android.
        </Text>
        <Text style={{ color: "#59718d", lineHeight: 22 }}>
          App nay la diem bat dau production cho Finger PPG voi camera sau + flash, Face PPG camera truoc,
          push notification, offline cache va dong bo voi API production.
        </Text>
      </View>
    </SafeAreaView>
  );
}
