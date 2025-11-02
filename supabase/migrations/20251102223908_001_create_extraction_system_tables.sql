/*
  # Sistema di Estrazione Senza Reinserimento

  1. New Tables
    - `extraction_config` - Configurazione del sistema di estrazione
    - `extraction_decks` - Mazzi personalizzati per l'estrazione
    
  2. Security
    - Enable RLS on both tables
    - Admin-only policies for management
    
  3. Details
    - extraction_config: memorizza se il sistema è visibile e abilitato
    - extraction_decks: memorizza i mazzi (default e personalizzati)
*/

CREATE TABLE IF NOT EXISTS extraction_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visible boolean DEFAULT false,
  enabled boolean DEFAULT false,
  default_deck text[] DEFAULT ARRAY['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extraction_decks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Default Deck',
  items text[] NOT NULL DEFAULT ARRAY['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
  is_active boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE extraction_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE extraction_decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read extraction config"
  ON extraction_config FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated update extraction config"
  ON extraction_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow public read extraction decks"
  ON extraction_decks FOR SELECT
  TO public
  USING (true);

CREATE POLICY "Allow authenticated manage extraction decks"
  ON extraction_decks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update extraction decks"
  ON extraction_decks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete extraction decks"
  ON extraction_decks FOR DELETE
  TO authenticated
  USING (true);

INSERT INTO extraction_config (visible, enabled, default_deck)
VALUES (false, false, ARRAY['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'])
ON CONFLICT DO NOTHING;
