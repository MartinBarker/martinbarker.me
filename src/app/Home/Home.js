import styles from "./Home.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <h1>Welcome to the Home Page</h1>
      <p>This is the main page of the application.</p>
    </div>
  );
}