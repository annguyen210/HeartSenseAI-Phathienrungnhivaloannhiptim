import React from "react";
import { SafeAreaView, Text, View } from "react-native";

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#eef4f7" }}>
      <View style={{ padding: 24, gap: 16 }}>
        <Text style={{ color: "#d94b63", fontWeight: "700" }}>HEARTSENSE Mobile</Text>
        <Text style={{ fontSize: 28, fontWeight: "700", color: "#163150" }}>
          Expo/native wrapper scaffold cho iOS và Android.
        </Text>
        <Text style={{ color: "#59718d", lineHeight: 22 }}>
          App này là điểm bắt đầu production cho Ngón Trỏ PPG với camera sau + flash, Face PPG camera trước,
          push notification, offline cache và đồng bộ với API production.
        </Text>
      </View>
    </SafeAreaView>
  );
}
