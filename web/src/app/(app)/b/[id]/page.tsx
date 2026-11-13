import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BusinessScreen } from "@/components/screens/BusinessScreen";
import { getBusiness } from "@/lib/near/rpc";
import type { Business } from "@/lib/near/types";

// Read on the server (cached ten seconds) so the page arrives with its figures, then kept live.
export const revalidate = 10;

type Props = { params: Promise<{ id: string }> };
type Read = { business?: Business; missing?: boolean };

/** The chain's own answer that there is no Lien business at an address, as opposed to a slow node. */
const NOT_A_BUSINESS = /UNKNOWN_ACCOUNT|INVALID_ACCOUNT|CodeDoesNotExist|does not exist|MethodNotFound|MethodResolveError/i;

/**
 * One read per request, shared by the title and the page. Server rendering waits at most
 * four seconds for the chain; after that the page renders and loads live in the browser.
 */
const read = cache(async (id: string): Promise<Read> => {
  const work = getBusiness(id).then(
    (business) => ({ business }),
    (error: unknown) => (NOT_A_BUSINESS.test(String(error instanceof Error ? error.message : error)) ? { missing: true } : {}),
  );
  return Promise.race([work, new Promise<Read>((resolve) => setTimeout(() => resolve({}), 4_000))]);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const { business, missing } = await read(id);
  if (missing) return { title: "No business here" };
  return { title: business?.name ?? id.split(".")[0], description: business ? `${business.name} on Lien: ${business.description}` : undefined };
}

export default async function Page({ params }: Props) {
  const id = decodeURIComponent((await params).id);
  const { business, missing } = await read(id);
  // A wrong or unknown address is a real 404, with its own page.
  if (missing) notFound();
  return <BusinessScreen id={id} initial={business} />;
}
