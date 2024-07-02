import Link from "next/link";
import { Button } from "~/components/ui/button";
import Footer from "~/sections/footer";
import Header from "~/sections/header";

export default function NotFound() {
  return (
    <>
      <Header />
      <div className="flex h-full w-full flex-col items-center justify-center gap-4">
        <p className="text-lg">Sorry, that page doesn't seem to exist.</p>
        <Button asChild>
          <Link href={`/`}>Go home</Link>
        </Button>
      </div>
      <Footer />
    </>
  );
}
