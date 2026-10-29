import { Suspense } from "react";
import { AccountBar } from "@/app/account-bar";
import { HomeScreen } from "@/app/home-screen";

export default function HomePage() {
  return (
    <HomeScreen>
      <Suspense fallback={null}>
        <AccountBar />
      </Suspense>
    </HomeScreen>
  );
}
