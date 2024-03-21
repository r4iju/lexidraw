import Link from "next/link";
import { Button } from "~/components/ui/button";
import Image from "~/components/image/image";
import { auth } from "~/server/auth";
import Header from "~/sections/header";
import Footer from "~/sections/footer";

export const runtime = "edge";

export const metadata = {
  title: "An excalidraw demo",
  description:
    "This is a demo of the excalidraw tool. It is a collaborative online drawing and diagramming tool.",
};

export default async function LandingPage() {
  const session = await auth();
  return (
    <>
      <Header />
      <div className="flex h-full flex-col">
        <main className="flex-1">
          <section id="about" className="w-full pt-12 md:pt-24 lg:pt-32">
            <div className="space-y-10 px-4 md:px-6 xl:space-y-16">
              <div className="mx-auto grid max-w-[1300px] gap-4 px-4 sm:px-6 md:grid-cols-2 md:gap-16 md:px-10">
                <div className="flex flex-col gap-3">
                  <h1 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
                    Excalidraw demo
                  </h1>
                  <p className="mx-auto max-w-[700px] text-gray-500 dark:text-gray-400 md:text-xl">
                    Collaborative online drawing and diagramming tool. Create
                    wireframes, flowcharts, user interfaces, and more. All saved
                    automatically and shareable with a link.
                  </p>
                  {!session?.user && (
                    <Button asChild>
                      <Link href="/signup">Sign up</Link>
                    </Button>
                  )}
                  {session?.user && (
                    <Button asChild>
                      <Link href="/dashboard">My drawings</Link>
                    </Button>
                  )}
                </div>

                <div>
                  <Image
                    alt="A web application for drawing and diagramming"
                    className="mx-auto aspect-[4/3] overflow-hidden rounded-2xl object-cover"
                    src="/images/homepage-banner.png"
                    height="500"
                    width="500"
                  />
                </div>
              </div>
            </div>
          </section>
          <section id="projects" className="w-full py-12 md:py-24 lg:py-32">
            <div className="container px-4 md:px-6">
              <h2 className="text-center text-3xl font-bold tracking-tighter sm:text-5xl">
                Sample projects
              </h2>
              <div className="mx-auto mt-12 grid items-start gap-8 sm:max-w-4xl sm:grid-cols-2 md:gap-12 lg:max-w-5xl lg:grid-cols-3">
                <div className="grid gap-1">
                  <Image
                    alt="Project 1"
                    className="mx-auto aspect-[7/6] overflow-hidden rounded-2xl object-cover"
                    height="350"
                    width="350"
                    src="/images/projects/project.png"
                  />
                  <h3 className="text-lg font-bold">Quick sketches</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Quick sketches
                  </p>
                </div>
                <div className="grid gap-1">
                  <Image
                    alt="Project 2"
                    className="mx-auto aspect-[7/6] overflow-hidden rounded-2xl object-cover"
                    height="350"
                    width="350"
                    src="/images/projects/project.png"
                  />
                  <h3 className="text-lg font-bold">Make wiregrams</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    A brief description of Project 2.
                  </p>
                </div>
                <div className="grid gap-1">
                  <Image
                    alt="Project 3"
                    className="mx-auto aspect-[7/6] overflow-hidden rounded-2xl object-cover"
                    height="350"
                    width="350"
                    src="/images/projects/project.png"
                  />
                  <h3 className="text-lg font-bold">Make a product pitch</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    A brief description of Project 3.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
      <Footer />
    </>
  );
}
