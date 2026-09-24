import { MarketingFrame } from "~/sections/marketing-frame";

type Props = {
  children: React.ReactNode;
};

export default function DefaultLayout({ children }: Props) {
  return <MarketingFrame>{children}</MarketingFrame>;
}
