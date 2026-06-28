import { AppPage } from "@/components/app-page";
import { RepositoryIndexList } from "@/components/repositories/repository-index-list";

export default function RepositoriesPage() {
  return (
    <AppPage githubContext={{ href: "/repositories", label: "repositories" }}>
      <RepositoryIndexList />
    </AppPage>
  );
}
