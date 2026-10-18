import { motion } from 'motion/react'

export const A = () => (
  <>
    <motion.div animate={{ x: 1 }} />
    <svg viewBox="0 0 1 1">
      <svg:rect width="1" />
    </svg>
    <my-widget size="2"></my-widget>
  </>
)
