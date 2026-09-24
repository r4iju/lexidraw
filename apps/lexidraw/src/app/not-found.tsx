import { NotFoundScreen } from "~/components/error-screen";
import Header from "~/sections/header";
import { auth } from "~/server/auth";

export default async function NotFound() {
  const session = await auth();
  return (
    <>
      <Header />
      <NotFoundScreen signedIn={Boolean(session?.user)} />
    </>
  );
}
