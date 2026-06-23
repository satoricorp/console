import { AppPage } from "@/components/app-page";
import { ConnectReposStep } from "@/components/onboarding/connect-repos-step";

export default function RepositoriesPage() {
  return (
    <AppPage>
      <ConnectReposStep
        eyebrow="Repositories"
        title="Connect GitHub repositories"
      />
    </AppPage>
  );
}
