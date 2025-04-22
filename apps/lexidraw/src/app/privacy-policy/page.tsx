export default function TermsOfService() {
  return (
    <div className="flex min-h-[calc(100vh-56px-65px)] flex-col">
      <main className="flex-1">
        <section
          id="terms-of-service"
          className="w-full pt-12 md:pt-24 lg:pt-32"
        >
          <div className="space-y-10 px-4 md:px-6 xl:space-y-16">
            <div className="mx-auto grid max-w-[1300px] gap-4 px-4 sm:px-6 md:grid-cols-2 md:gap-16 md:px-10">
              <div className="flex flex-col gap-3">
                <h1 className="lg:leading-tighter text-3xl font-bold tracking-tighter sm:text-4xl md:text-5xl xl:text-[3.4rem] 2xl:text-[3.75rem]">
                  Privacy Policy
                </h1>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  Introduction
                </h2>
                <p>
                  Your privacy is important to us. This Privacy Policy explains
                  how we collect, use, share, and protect information in
                  relation to our service.
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  Information We Collect
                </h2>
                <p>We collect the following types of information:</p>
                <p>
                  <ul>
                    <li>
                      Information you provide us directly: We ask for certain
                      information such as your username, and email address when
                      you use our service, if you correspond with us.
                    </li>
                    <li>
                      Analytics information: We use analytics tools to help us
                      measure traffic and usage trends for the service.
                    </li>
                  </ul>
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  How We Use Your Information
                </h2>
                <p>
                  We use the information we collect to operate, maintain, and
                  provide to you the features and functionality of the service,
                  such as:
                </p>
                <p>
                  <ul>
                    <li>
                      To allow you to create and share drawings and diagrams.
                    </li>
                    <li>
                      To improve and test the effectiveness of the service.
                    </li>
                    <li>
                      To monitor metrics such as total number of visitors,
                      traffic, and demographic patterns.
                    </li>
                  </ul>
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  Sharing of Your Information
                </h2>
                <p>
                  We will not rent or sell your information to third parties
                  outside [Service Name] without your consent, except as noted
                  in this Policy.
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  Your Choices About Your Information
                </h2>
                <p>
                  You may update your account information and preferences at any
                  time. You may also unsubscribe from email communications from
                  us.
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  {"Children's Privacy"}
                </h2>
                <p>
                  [Service Name] does not knowingly collect or solicit any
                  information from anyone under the age of 13 or knowingly allow
                  such persons to register for the service.
                </p>
                <h2 className="lg:leading-tighter text-xl font-bold tracking-tighter sm:text-4xl md:text-2xl ">
                  Changes to Our Privacy Policy
                </h2>
                <p>
                  We may modify or update this Privacy Policy from time to time,
                  so please review it periodically. Your continued use of the
                  service after any modification to this Privacy Policy will
                  constitute your acceptance of such modification.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
