import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BooksScreen } from "@/components/screens/BooksScreen";
import type { Books } from "@/lib/books";
import { cachedBooks, isBusinessId } from "@/lib/booksRead";

export const revalidate = 10;

type Props = { params: Promise<{ id: string }> };
type Read = { books?: Books; missing?: boolean };

const NOT_A_BUSINESS = /UNKNOWN_ACCOUNT|INVALID_ACCOUNT|CodeDoesNotExist|does not exist|MethodNotFound|MethodResolveError/i;

/** One read per request, shared by the title and the page; after four seconds the browser takes over. */
const read = cache(async (id: string): Promise<Read> => {
  if (!isBusinessId(id)) return { missing: true };
  const work = cachedBooks(id).then(
    (books) => ({ books }),
    (error: unknown) => (NOT_A_BUSINESS.test(String(error instanceof Error ? error.message : error)) ? { missing: true } : {}),
  );
  return Promise.race([work, new Promise<Read>((resolve) => setTimeout(() => resolve({}), 4_000))]);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = decodeURIComponent((await params).id);
  const { books, missing } = await read(id);
  if (missing) return { title: "No business here" };
  const name = books?.name ?? id.split(".")[0];
  return { title: `${name}: books`, description: `${name}'s income, balance sheet, customers, loans and spending policy, computed from its contract on NEAR.` };
}

export default async function Page({ params }: Props) {
  const id = decodeURIComponent((await params).id);
  const { books, missing } = await read(id);
  if (missing) notFound();
  return <BooksScreen id={id} initial={books} />;
}
