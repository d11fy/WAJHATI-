import type { Metadata } from "next";
import { connection } from "next/server";
import { AuthPage } from "@/components/auth-page";
import { copy } from "@/lib/copy";
import { routeLocale } from "@/server/locale";

export async function generateMetadata({ params }: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  return { title: copy[await routeLocale(params)].signIn, robots: { index: false, follow: false } };
}

export default async function SignIn({ params }: PageProps<"/[locale]/sign-in">) {
  await connection();
  return <AuthPage locale={await routeLocale(params)} mode="sign-in" />;
}
