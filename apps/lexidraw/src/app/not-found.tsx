import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { NotFoundScreen } from "~/components/error-screen";
import Header from "~/sections/header";
import { appBarAccount } from "~/server/app-bar-account";

/**
 * A page that is not there: under the app bar every signed-in page has, a
 * step from Home, for someone signed in; under the site's header for a
 * visitor.
 */
export default async function NotFound() {
  const account = await appBarAccount();
  return (
    <>
      {account ? (
        <AppBar
          account={account}
          crumbs={
            <Crumb current>
              <span className="truncate px-1.5 font-medium">
                Page not found
              </span>
            </Crumb>
          }
        />
      ) : (
        <Header />
      )}
      <NotFoundScreen signedIn={account !== null} />
    </>
  );
}
