import Image from "next/image";
import { Compass } from "lucide-react";
import { LoginForm } from "@/components/auth/login-form";
import loginIllustration from "@/public/images/login-knowledge-map.png";
import styles from "@/components/auth/login.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="Eureka Atlas 数据探索">
        <div className={styles.brand}><Compass strokeWidth={1.5} /><span>Eureka Atlas</span></div>
        <div className={styles.artwork}>
          <Image src={loginIllustration} alt="四位同事围绕电脑和数据图表协作讨论的黑白手绘插画" fill priority sizes="(min-width: 768px) 50vw, 100vw" className="object-contain" />
        </div>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>EXPLORE · CONNECT · DISCOVER</p>
          <h2>让数据成为地图，<br />让洞察找到方向。</h2>
          <p className={styles.description}>连接分散的数据，构建清晰的语义。<br />从每一次探索，走向更有价值的发现。</p>
        </div>
      </section>
      <section className={styles.formPanel}>
        <div className={`${styles.brand} ${styles.mobileBrand}`}><Compass />Eureka Atlas</div>
        <div className={styles.formContainer}><LoginForm /></div>
        <p className={styles.footer}>Eureka Atlas · 数据语义治理平台</p>
      </section>
    </main>
  );
}
