import { Counter } from './components/Counter'
import { FeatureList } from './components/FeatureList'
import { Header } from './components/Header'

function App() {
  return (
    <main>
      <Header title="Change Spotlight playground" />
      <FeatureList />
      <Counter />
      <div style={{ height: '150vh' }} />
      <footer id="pricing">
        <p>Pricing: fre e while in spike.</p>
      </footer>
    </main>
  )
}

export default App
