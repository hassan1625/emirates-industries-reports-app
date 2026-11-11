import { redirect } from "react-router";
import styles from "./styles.module.css";

// The address's front page. Shopify opens the app with ?shop=..., which goes straight to the app;
// anyone else (this app is for one store, there is no public sign-up) sees where to find it.
export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null;
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Emirates Custom Report App</h1>
        <p className={styles.text}>
          Sales and stock reports for Emirates Industries. Open the app from the
          Shopify admin, under Apps.
        </p>
      </div>
    </div>
  );
}
