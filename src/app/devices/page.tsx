import { AppPage } from "@/components/app-page";
import { DeviceList } from "@/components/devices/device-list";

export default function DevicesPage() {
  return (
    <AppPage githubContext={{ href: "/devices", label: "devices" }}>
      <DeviceList />
    </AppPage>
  );
}
