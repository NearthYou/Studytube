import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'email_verifications' })
export class EmailVerificationEntity {
  @PrimaryColumn({ name: 'email', type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'code', type: 'varchar', length: 6 })
  code: string;

  @Index()
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  @Index()
  @Column({ name: 'verified_expires_at', type: 'timestamptz', nullable: true })
  verifiedExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
