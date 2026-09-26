import { PageFrame } from "~/sections/page-frame";

type Props = {
  children: React.ReactNode;
};

export default function DefaultLayout({ children }: Props) {
  return <PageFrame>{children}</PageFrame>;
}
